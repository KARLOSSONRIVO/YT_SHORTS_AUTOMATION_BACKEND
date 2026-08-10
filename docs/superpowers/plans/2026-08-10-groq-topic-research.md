# Groq Topic Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace backend Gemini topic research and embeddings with Groq Compound web research plus local deterministic embeddings.

**Architecture:** `TopicResearchService` remains a backend-owned service but changes to Groq's OpenAI-compatible `/chat/completions` contract using `groq/compound`, JSON object mode, and built-in web tools. Candidate parsing and quality gates remain in place, while `DuplicateDetector.embedding()` replaces Gemini Embeddings and provider retry naming becomes generic.

**Tech Stack:** TypeScript 5.8, Node.js test runner, Axios, Zod, BullMQ, Groq Compound API, Docker Compose

## Global Constraints

- Gemini remains unchanged in the Python worker for image generation and TTS.
- AI animation provider routing is outside this migration.
- Topic research must retain live web research and at least two source URLs per accepted candidate.
- `GROQ_TOPIC_RESEARCH_MODEL` defaults to exactly `groq/compound`.
- `GROQ_API_BASE_URL` defaults to exactly `https://api.groq.com/openai/v1`.
- Provider retry delays remain exactly 30, 60, then 120 seconds, capped at 120 seconds.
- Never print API keys or include them in tests, snapshots, diffs, or logs.
- Target implementation files contain pre-existing uncommitted user work. Do not stage or commit them automatically; use focused diffs and verification checkpoints instead.

## File Map

- `src/modules/automation/topic-research.service.ts`: Groq Compound request, response parsing, local embeddings, and Groq errors.
- `src/modules/automation/retry-policy.ts`: provider-neutral retry-delay export.
- `src/modules/automation/automation.service.ts`: provider-neutral BullMQ backoff name and activity message.
- `src/worker.ts`: provider-neutral BullMQ backoff strategy registration.
- `src/modules/services/facelessVideo/faceless-video.service.ts`: provider-neutral rate-limit status text.
- `src/config/env.ts`: backend Groq topic-research settings; removal of backend Gemini settings.
- `src/config/container.ts`: construct `TopicResearchService` with Groq settings.
- `tests/automation.test.ts`: Groq request-contract, parsing, embedding, error, and retry-policy coverage.

---

### Task 1: Replace the Topic Research Provider

**Files:**
- Modify: `tests/automation.test.ts`
- Modify: `src/modules/automation/topic-research.service.ts`

**Interfaces:**
- Consumes: `DuplicateDetector.embedding(value: string, dimensions?: number): number[]`
- Produces: `new TopicResearchService(apiKey: string | undefined, model: string, baseUrl: string)`
- Produces: `TopicResearchService.generate(input): Promise<TopicCandidate[]>`

- [ ] **Step 1: Replace the Gemini provider tests with failing Groq contract tests**

Replace the two Gemini topic-research tests with tests equivalent to:

```ts
test("Groq 429 responses become actionable retryable errors", async () => {
  const post = mock.method(axios, "post", async () => {
    throw {
      isAxiosError: true,
      response: {
        status: 429,
        data: { error: { message: "Rate limit reached", code: "rate_limit_exceeded" } },
        headers: { "retry-after": "60" }
      }
    };
  });
  try {
    const service = new TopicResearchService("test-key", "groq/compound", "https://api.groq.test/openai/v1");
    await assert.rejects(
      () => service.generate({ profile, language: "en", region: "US", recentTopics: [], recentEntities: [] }),
      error => error instanceof AppError && error.code === "GROQ_RATE_LIMITED" && error.message.includes("Automatic retries")
    );
  } finally {
    post.mock.restore();
  }
});

test("topic research uses Groq Compound web tools and local embeddings", async () => {
  const candidates = [0, 1, 2].map(index => ({ ...candidate, topic: `Topic ${index}`, title: `Title ${index}` }));
  const post = mock.method(axios, "post", async (url: string, body: unknown, config: { headers?: Record<string, string> }) => {
    const request = body as {
      model: string;
      response_format: { type: string };
      compound_custom: { tools: { enabled_tools: string[] } };
    };
    assert.equal(url, "https://api.groq.test/openai/v1/chat/completions");
    assert.equal(request.model, "groq/compound");
    assert.deepEqual(request.response_format, { type: "json_object" });
    assert.deepEqual(request.compound_custom.tools.enabled_tools, ["web_search", "visit_website"]);
    assert.equal(config.headers?.Authorization, "Bearer test-key");
    assert.equal(config.headers?.["Groq-Model-Version"], "latest");
    return { data: { choices: [{ message: { content: JSON.stringify({ candidates }) } }] } };
  });
  try {
    const service = new TopicResearchService("test-key", "groq/compound", "https://api.groq.test/openai/v1/");
    const result = await service.generate({ profile, language: "en", region: "US", recentTopics: [], recentEntities: [] });
    assert.equal(result.length, 3);
    assert.equal(result[0].embedding?.length, 96);
    assert.equal(post.mock.callCount(), 1);
  } finally {
    post.mock.restore();
  }
});
```

- [ ] **Step 2: Run the focused tests and verify the red state**

Run:

```powershell
node --import tsx --test --test-name-pattern "Groq|topic research" tests/automation.test.ts
```

Expected: FAIL because the existing constructor and response contract still expect Gemini, and `GROQ_RATE_LIMITED` does not exist.

- [ ] **Step 3: Implement the minimal Groq Compound service**

Refactor `TopicResearchService` to use this request shape and parsing boundary:

```ts
import axios from "axios";
import { AppError } from "../../common/errors/app-error";
import { DuplicateDetector } from "./duplicate-detector";
import type { NicheProfile, TopicCandidate } from "./automation.types";

interface GroqCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class TopicResearchService {
  private readonly duplicate = new DuplicateDetector();

  constructor(
    private readonly apiKey: string | undefined,
    private readonly model: string,
    private readonly baseUrl: string
  ) {}

  public async generate(input: {
    profile: NicheProfile;
    language: string;
    region: string;
    recentTopics: string[];
    recentEntities: string[];
    count?: number;
  }): Promise<TopicCandidate[]> {
    if (!this.apiKey) {
      throw new AppError("GROQ_API_KEY is required for automated topic research.", 503, "GROQ_NOT_CONFIGURED");
    }
    const response = await this.post(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      model: this.model,
      messages: [{ role: "user", content: this.buildPrompt(input) }],
      temperature: 0.65,
      max_completion_tokens: 5000,
      response_format: { type: "json_object" },
      compound_custom: { tools: { enabled_tools: ["web_search", "visit_website"] } }
    });
    const candidates = this.parseCandidates(response.data);
    return candidates.map(candidate => ({
      ...candidate,
      embedding: this.duplicate.embedding(`${candidate.topic}\n${candidate.summary}\n${candidate.storyAngle}`)
    }));
  }
}
```

Implement `post()` with `Authorization: Bearer <key>`, `Content-Type: application/json`, `Groq-Model-Version: latest`, and a 120-second timeout. Map 429, 5xx, and other failures to the exact Groq codes in the design. Make `parseCandidates()` read `choices[0].message.content`, strip optional Markdown fences, parse `{ candidates }`, and retain the existing source/confidence filters. Change the prompt from “Use Google Search” to instructions requiring Groq web search, source-page visits, current verification, and JSON-only output.

- [ ] **Step 4: Run focused tests and verify green**

Run:

```powershell
node --import tsx --test --test-name-pattern "Groq|topic research" tests/automation.test.ts
```

Expected: 2 passing tests, 0 failures.

- [ ] **Step 5: Check the focused diff without staging user work**

Run:

```powershell
git diff --check -- src/modules/automation/topic-research.service.ts tests/automation.test.ts
git diff -- src/modules/automation/topic-research.service.ts tests/automation.test.ts
```

Expected: no whitespace errors; diff contains only the provider migration and related tests.

---

### Task 2: Make Retry Handling Provider-Neutral

**Files:**
- Modify: `tests/automation.test.ts`
- Modify: `src/modules/automation/retry-policy.ts`
- Modify: `src/modules/automation/automation.service.ts`
- Modify: `src/worker.ts`
- Modify: `src/modules/services/facelessVideo/faceless-video.service.ts`

**Interfaces:**
- Produces: `providerRetryDelayMs(attempt: number): number`
- Produces: `automationRetryOptions(): { attempts: 1000; backoff: { type: "provider-rate-limit" } }`
- Consumes: `isRateLimitFailure(error: unknown): boolean`

- [ ] **Step 1: Write failing provider-neutral retry assertions**

Update the retry import and assertions to:

```ts
import {
  providerRetryDelayMs,
  isQueuedWorkflowFailure,
  isRateLimitFailure,
  isTemporaryFailure,
  retryDelayMs
} from "../src/modules/automation/retry-policy";

test("automation retries stay queued with the provider rate-limit policy", () => {
  assert.deepEqual(automationRetryOptions(), {
    attempts: 1000,
    backoff: { type: "provider-rate-limit" }
  });
});

test("provider retry delays are exactly 30, 60, then 120 seconds", () => {
  assert.deepEqual([1, 2, 3, 4].map(providerRetryDelayMs), [30000, 60000, 120000, 120000]);
});

test("provider HTTP 429 is treated as a rate limit", () => {
  assert.equal(isRateLimitFailure(new AppError("rate", 429, "RATE_LIMITED")), true);
  assert.equal(isRateLimitFailure(new AppError("queued", 429, "AUTOMATION_JOB_QUEUED")), false);
  assert.equal(isQueuedWorkflowFailure(new AppError("queued", 429, "AUTOMATION_JOB_QUEUED")), true);
  assert.equal(isRateLimitFailure(new AppError("server", 503, "UPSTREAM")), false);
});
```

- [ ] **Step 2: Run the retry tests and verify the red state**

Run:

```powershell
node --import tsx --test --test-name-pattern "provider|rate limit" tests/automation.test.ts
```

Expected: FAIL because `providerRetryDelayMs` and `provider-rate-limit` are not implemented.

- [ ] **Step 3: Rename the policy and messages**

Make these exact changes:

```ts
// retry-policy.ts
export const providerRetryDelayMs = (attempt: number) =>
  [30_000, 60_000, 120_000][Math.min(Math.max(attempt - 1, 0), 2)];

// automation.service.ts
export const automationRetryOptions = () => ({
  attempts: 1000,
  backoff: { type: "provider-rate-limit" as const }
});

// worker.ts
backoffStrategy: (attemptsMade: number, type?: string) =>
  type === "provider-rate-limit" ? providerRetryDelayMs(attemptsMade) : -1
```

Change `AutomationService.recordFailure()` to “AI provider rate limit reached…” and the faceless stage status to “AI provider rate limit reached…” / “Rate limited by the AI provider…”. Do not change the status transitions or delay values.

- [ ] **Step 4: Run retry tests and verify green**

Run:

```powershell
node --import tsx --test --test-name-pattern "provider|rate limit" tests/automation.test.ts
```

Expected: all matching tests pass.

- [ ] **Step 5: Check for stale Gemini retry labels**

Run:

```powershell
rg -n "gemini-rate-limit|geminiRetryDelayMs|Gemini rate limit|Rate limited by Gemini" src tests
```

Expected: no matches.

---

### Task 3: Wire Backend Groq Configuration

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/config/container.ts`

**Interfaces:**
- Produces: `env.GROQ_API_KEY: string | undefined`
- Produces: `env.GROQ_TOPIC_RESEARCH_MODEL: string`
- Produces: `env.GROQ_API_BASE_URL: string`
- Consumes: `TopicResearchService(apiKey, model, baseUrl)` from Task 1

- [ ] **Step 1: Run typecheck and capture the constructor mismatch**

Run:

```powershell
npx tsc --noEmit -p tsconfig.json
```

Expected: FAIL at `src/config/container.ts` because it still passes five Gemini constructor arguments to the new three-argument Groq service.

- [ ] **Step 2: Replace the backend environment keys**

Replace the backend Gemini block in `env.ts` with:

```ts
GROQ_API_KEY: z.string().min(1).optional(),
GROQ_TOPIC_RESEARCH_MODEL: z.string().default("groq/compound"),
GROQ_API_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
```

Do not edit or print `.env` values.

- [ ] **Step 3: Update dependency injection**

Construct the service in `container.ts` exactly as:

```ts
const topicResearchService = new TopicResearchService(
  env.GROQ_API_KEY,
  env.GROQ_TOPIC_RESEARCH_MODEL,
  env.GROQ_API_BASE_URL
);
```

- [ ] **Step 4: Run typecheck and verify green**

Run:

```powershell
npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 5: Prove backend topic research has no Gemini dependency**

Run:

```powershell
rg -n "GEMINI|generativelanguage.googleapis.com|google_search|embedContent" src/modules/automation/topic-research.service.ts src/config/env.ts src/config/container.ts tests/automation.test.ts
```

Expected: no matches.

---

### Task 4: Full Verification and Container Rollout

**Files:**
- Verify: all files from Tasks 1-3
- No additional source files

**Interfaces:**
- Consumes: completed Groq topic-research service and backend environment wiring
- Produces: rebuilt running backend services using Groq Compound for topic research

- [ ] **Step 1: Run the complete backend test suite**

Run:

```powershell
npm test
```

Expected: all tests pass with 0 failures.

- [ ] **Step 2: Run typecheck and production build**

Run:

```powershell
npx tsc --noEmit -p tsconfig.json
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 3: Run static safety checks**

Run:

```powershell
git diff --check
rg -n "GEMINI_RATE_LIMITED|Gemini is temporarily rate-limited|grounded Gemini|google_search|embedContent" src tests
```

Expected: no whitespace errors and no stale backend topic-research Gemini references.

- [ ] **Step 4: Rebuild and restart backend services**

Run:

```powershell
docker compose up -d --build backend backend-worker automation-scheduler
docker compose ps backend backend-worker automation-scheduler redis mongo
```

Expected: all five services show `Up`; no service is restarting.

- [ ] **Step 5: Verify the compiled container uses Groq**

Run a secret-safe Node inspection inside `backend-worker` that reads the compiled topic-research module and prints only booleans:

```powershell
docker compose exec -T backend-worker node -e "const fs=require('fs');const code=fs.readFileSync('dist/src/modules/automation/topic-research.service.js','utf8');console.log(JSON.stringify({usesGroq:code.includes('api.groq.com')||code.includes('GROQ_'),usesCompound:code.includes('compound_custom'),usesGemini:code.includes('GEMINI_')||code.includes('google_search')}));"
```

Expected:

```json
{"usesGroq":true,"usesCompound":true,"usesGemini":false}
```

- [ ] **Step 6: Perform one controlled live research smoke test**

Invoke the compiled `TopicResearchService` inside `backend-worker` with `count: 3`, a minimal test niche profile, and the configured Groq environment. Print only the returned candidate count, whether all candidates have at least two HTTPS sources, and whether all embeddings have 96 dimensions. Never print the response body, authorization header, or environment values.

Expected:

```json
{"count":3,"sourcesValid":true,"embeddingsValid":true}
```

- [ ] **Step 7: Review the final worktree without committing user changes**

Run:

```powershell
git status --short
git diff --check
git diff -- src/modules/automation/topic-research.service.ts src/modules/automation/retry-policy.ts src/modules/automation/automation.service.ts src/worker.ts src/modules/services/facelessVideo/faceless-video.service.ts src/config/env.ts src/config/container.ts tests/automation.test.ts
```

Expected: implementation diff is limited to the approved migration; unrelated pre-existing changes remain present and unstaged.
