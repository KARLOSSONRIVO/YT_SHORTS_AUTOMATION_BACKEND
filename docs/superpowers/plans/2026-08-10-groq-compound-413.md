# Groq Compound 413 Mitigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover safely from intermittent Groq Compound 413 failures without retrying genuinely oversized application requests.

**Architecture:** `TopicResearchService` owns model-version selection, request measurement, provider error translation, and safe request diagnostics. The existing retry-policy and worker-policy helpers classify the new application error and expose only allowlisted metadata; BullMQ retains the existing three-attempt boundary and 60-second automation limiter.

**Tech Stack:** TypeScript 5.8, Axios, BullMQ 5, Node.js test runner, Docker Compose

## Global Constraints

- Continue using `groq/compound-mini` with `web_search`.
- Set `Groq-Model-Version` to `2025-07-23`.
- Retry 413 only for provider code `request_too_large` when the serialized request is at most 65,536 bytes.
- Allow at most three total attempts through the existing research retry boundary.
- Never log the API key, authorization header, prompt, or response content.
- Preserve unrelated working-tree changes and do not commit implementation files automatically.

---

### Task 1: Define the boundary behavior with failing tests

**Files:**
- Test: `tests/automation.test.ts`

**Interfaces:**
- Consumes: `TopicResearchService.generate(...)`, `isRetryableResearchFailure(...)`, `shouldRetryResearchFailure(...)`, and `providerFailureMetadata(...)`.
- Produces: regression coverage for Basic Search and small-request 413 recovery.

- [ ] Change the request-contract assertion to expect `Groq-Model-Version: 2025-07-23`.
- [ ] Add an Axios 413 fixture with `request_too_large` and `x-request-id`; assert `GROQ_COMPOUND_REQUEST_TOO_LARGE`, status 503, request bytes below 65,536, and the request ID.
- [ ] Assert the new code is retryable for attempts made 0 and 1 but not 2.
- [ ] Assert safe logging includes `requestId` and `requestBodyBytes` but excludes secrets.
- [ ] Run the focused tests and confirm they fail for the missing behavior.

### Task 2: Implement the minimal provider and retry changes

**Files:**
- Modify: `src/modules/automation/topic-research.service.ts`
- Modify: `src/modules/automation/retry-policy.ts`
- Modify: `src/modules/automation/automation-worker-policy.ts`

**Interfaces:**
- Produces: `GROQ_COMPOUND_REQUEST_TOO_LARGE` with safe diagnostics for small provider-side 413 failures.
- Produces: bounded retry classification through the existing `shouldRetryResearchFailure` interface.

- [ ] Serialize the Axios request body once for an exact UTF-8 byte count.
- [ ] Pin the Compound version header to `2025-07-23`.
- [ ] Capture `x-request-id` and `requestBodyBytes` in error details.
- [ ] Translate qualifying 413 responses into the new 503 application error.
- [ ] Add the code to the bounded research-retry set and metadata allowlist.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Verify and deploy

**Files:**
- Verify: `src/modules/automation/topic-research.service.ts`
- Verify: `src/modules/automation/retry-policy.ts`
- Verify: `src/modules/automation/automation-worker-policy.ts`
- Verify: `tests/automation.test.ts`

**Interfaces:**
- Produces: rebuilt backend, backend-worker, and scheduler containers.

- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`.
- [ ] Rebuild `backend`, `backend-worker`, and `automation-scheduler` with Docker Compose.
- [ ] Verify the deployed artifact contains Basic Search and the new bounded retry code.
- [ ] Run a live Groq smoke test that prints only validation summaries, never generated content or credentials.
