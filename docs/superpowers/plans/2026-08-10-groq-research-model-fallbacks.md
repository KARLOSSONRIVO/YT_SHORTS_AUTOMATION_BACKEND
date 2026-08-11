# Groq Research Model Fallbacks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Qwen and Llama 3.1 8B as sequential HTTP-429 fallbacks for Compound Mini topic research.

**Architecture:** `TopicResearchService` will own an ordered, deduplicated model chain. It will build a Compound request with web search for the primary model and direct JSON requests for fallbacks, continuing only after `GROQ_RATE_LIMITED`. Environment configuration supplies the fallback IDs through the existing application container.

**Tech Stack:** TypeScript, Axios, Zod, Node test runner, Docker Compose

## Global Constraints

- Primary: `groq/compound-mini` with web search.
- First fallback: `qwen/qwen3.6-27b` with `reasoning_effort: "none"` and no Compound tools.
- Second fallback: `llama-3.1-8b-instant` with no Compound tools.
- Switch models only after HTTP 429.
- Preserve the existing final `GROQ_RATE_LIMITED` queue retry behavior.

---

### Task 1: Research Request Chain

**Files:**
- Modify: `src/modules/automation/topic-research.service.ts`
- Test: `tests/automation.test.ts`

**Interfaces:**
- Consumes: `new TopicResearchService(apiKey, primaryModel, baseUrl, fallbackModels)`.
- Produces: ordered research attempts returning the first valid Groq completion.

- [ ] **Step 1: Write failing request-chain tests**

Add an Axios test that returns 429 for Compound and Qwen, then returns valid candidates for Llama. Assert the model order and model-specific payload fields. Add a second test asserting that a final 429 still produces `GROQ_RATE_LIMITED`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- --test-name-pattern="research falls back|final research fallback"`

Expected: FAIL because the constructor has no fallback chain and only one request is sent.

- [ ] **Step 3: Implement minimal model chaining**

Build a unique model list, loop through it, and continue only when the caught error is an `AppError` with code `GROQ_RATE_LIMITED`. Build Compound and direct-model payloads separately; add Qwen's non-thinking option.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- --test-name-pattern="research falls back|final research fallback"`

Expected: both tests pass.

### Task 2: Configuration Wiring

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/config/container.ts`
- Modify: `.env`
- Test: `tests/automation.test.ts`

**Interfaces:**
- Produces: `GROQ_TOPIC_RESEARCH_FALLBACK_MODEL` and `GROQ_TOPIC_RESEARCH_SECONDARY_FALLBACK_MODEL` defaults passed as an array.

- [ ] **Step 1: Add failing configuration source assertions**

Assert the environment schema and container source include both exact fallback variables and pass them into `TopicResearchService`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --test-name-pattern="research fallback configuration"`

Expected: FAIL because the variables do not exist.

- [ ] **Step 3: Add defaults, wiring, and explicit `.env` values**

Use `qwen/qwen3.6-27b` and `llama-3.1-8b-instant`, then pass both values to the service constructor.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --test-name-pattern="research fallback configuration"`

Expected: PASS.

### Task 3: Verification and Deployment

**Files:**
- Verify all modified backend files.

**Interfaces:**
- Consumes: completed Tasks 1 and 2.
- Produces: deployed backend services with the fallback chain.

- [ ] **Step 1: Run full checks**

Run: `npm test`, `npm run build`, and `git diff --check`.

- [ ] **Step 2: Rebuild and recreate backend services**

Run: `docker compose up -d --build --force-recreate backend backend-worker automation-scheduler`.

- [ ] **Step 3: Verify runtime configuration and queue progress**

Confirm the worker sees all three model IDs, then inspect the previously delayed automation job for completion or a new non-rate-limit failure.

