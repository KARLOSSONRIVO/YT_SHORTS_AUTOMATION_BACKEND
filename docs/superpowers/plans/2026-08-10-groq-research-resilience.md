# Groq Research Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pace Groq topic-research jobs, reduce response size, honor provider retry timing, retry malformed research a bounded number of times, and expose safe quota diagnostics.

**Architecture:** Keep topic research in `TopicResearchService` and queue orchestration in `worker.ts`. Pure retry-policy helpers will parse provider timing and classify research response errors, while worker construction applies a limiter only to automation jobs and bounds response-shape retries using `job.attemptsMade`.

**Tech Stack:** TypeScript 5.8, Node.js test runner, Axios, BullMQ 5, Docker Compose

## Global Constraints

- Gemini remains limited to image generation and TTS outside backend topic research.
- Groq topic research continues using `groq/compound-mini` with `web_search`.
- Automation admits at most one job per 60 seconds.
- Research response failures receive at most three total job attempts.
- Do not log API keys or generated research content.
- Preserve unrelated dirty working-tree changes and do not commit implementation files automatically.

---

### Task 1: Reduce Groq research response size and capture quota metadata

**Files:**
- Modify: `src/modules/automation/topic-research.service.ts`
- Test: `tests/automation.test.ts`

**Interfaces:**
- Consumes: `TopicResearchService.generate(input)` with optional `input.count`.
- Produces: a default prompt count of three and `AppError.details` containing safe Groq rate-limit fields.

- [ ] **Step 1: Write failing tests**

Extend the existing Axios request mock to assert that a request without `count` contains `Research 3 factual short-video topics`. Extend the 429 test to supply Groq limit headers and assert the resulting `AppError.details` contains `retryAfter`, request-limit, and token-limit fields.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm test -- --test-name-pattern="Groq 429|Compound Mini"
```

Expected: failure because the prompt still requests eight topics and quota headers are not copied into error details.

- [ ] **Step 3: Implement minimal service changes**

Change the prompt fallback from `input.count ?? 8` to `input.count ?? 3`. Copy only these normalized response headers into `AppError.details`: `retry-after`, `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests`, `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, and `x-ratelimit-reset-tokens`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused test command and confirm both tests pass.

### Task 2: Honor retry-after and classify bounded research retries

**Files:**
- Modify: `src/modules/automation/retry-policy.ts`
- Test: `tests/automation.test.ts`

**Interfaces:**
- Produces: `providerRetryDelayMs(attempt: number, error?: unknown): number`.
- Produces: `isRetryableResearchFailure(error: unknown): boolean`.
- Produces: `shouldRetryResearchFailure(error: unknown, attemptsMade: number): boolean`.

- [ ] **Step 1: Write failing policy tests**

Add tests proving: `retry-after: "75"` returns `75000`; malformed retry-after falls back to 30/60/120 seconds; `RESEARCH_RESPONSE_INVALID` and `INSUFFICIENT_RESEARCH_CANDIDATES` are research-retryable; and attemptsMade values 0 and 1 retry while 2 does not.

- [ ] **Step 2: Run the focused policy tests and verify RED**

Run:

```powershell
npm test -- --test-name-pattern="provider retry|research response"
```

Expected: failure because the new signatures and helpers do not exist.

- [ ] **Step 3: Implement pure policy helpers**

Read `AppError.details.retryAfter`, accept only a finite positive numeric seconds value, and convert it to milliseconds. Add a set containing exactly `RESEARCH_RESPONSE_INVALID` and `INSUFFICIENT_RESEARCH_CANDIDATES`; allow those failures only when `attemptsMade < 2`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused policy tests and confirm they pass.

### Task 3: Pace automation work and expose safe failure diagnostics

**Files:**
- Modify: `src/worker.ts`
- Test: `tests/automation.test.ts`

**Interfaces:**
- Produces: `AUTOMATION_RATE_LIMITER = { max: 1, duration: 60_000 }`.
- Produces: `providerFailureMetadata(error: unknown): Record<string, unknown>` for safe logs.
- Consumes: `shouldRetryResearchFailure` and the optional error argument in `providerRetryDelayMs`.

- [ ] **Step 1: Write failing worker-policy tests**

Assert the exported limiter value and assert safe metadata includes Groq code/status/quota fields but no API key. Test the retry decision through the pure helper rather than starting a live worker.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test -- --test-name-pattern="automation limiter|provider failure metadata|research response"
```

Expected: failure because the exports do not exist.

- [ ] **Step 3: Implement worker integration**

Pass the original error into `providerRetryDelayMs`. Apply `{ limiter: AUTOMATION_RATE_LIMITER }` only to the automation `Worker`. Allow rate-limit, queued-workflow, and bounded research-response failures to remain retryable; wrap all others in `UnrecoverableError`. Add safe structured metadata to the failed-event log.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused tests and confirm they pass.

### Task 4: Full verification and deployment

**Files:**
- Verify: `src/modules/automation/topic-research.service.ts`
- Verify: `src/modules/automation/retry-policy.ts`
- Verify: `src/worker.ts`
- Verify: `tests/automation.test.ts`

**Interfaces:**
- Produces: rebuilt backend, backend worker, and scheduler containers.

- [ ] **Step 1: Run complete local verification**

Run:

```powershell
npm test
npx tsc --noEmit -p tsconfig.json
npm run build
git diff --check
```

Expected: all tests pass, typecheck and build exit zero, and no whitespace errors appear.

- [ ] **Step 2: Rebuild backend services**

Run:

```powershell
docker compose up -d --build backend backend-worker automation-scheduler
docker compose ps backend backend-worker automation-scheduler redis mongo
```

Expected: all named services are running.

- [ ] **Step 3: Inspect deployed artifact and logs**

Confirm the compiled service requests three candidates, the automation worker contains the 60-second limiter and retry-after-aware backoff, and startup logs contain no errors.

- [ ] **Step 4: Run one live Groq smoke test**

Invoke the compiled `TopicResearchService` with `count` omitted and print only candidate count, source validation, confidence validation, and embedding dimensions.

Expected: three candidates, at least two sources each, confidence at least 0.6, and 96-dimensional embeddings.
