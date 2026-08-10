# Groq Compound 413 Mitigation Design

## Goal

Prevent intermittent Groq Compound Mini `413 request_too_large` failures from permanently failing topic-research jobs when the application request itself is small.

## Evidence

The failing Philippine-history request serializes to about 1.1 KB, and the same request can succeed unchanged. Groq quota headers also show substantial remaining request and token capacity. This rules out application request size and rate-limit exhaustion; the intermittent failure occurs inside Groq's newer Compound Advanced Search orchestration.

## Selected Approach

- Keep `groq/compound-mini` and its `web_search` tool.
- Pin `Groq-Model-Version` to `2025-07-23`, which uses the smaller Basic Search orchestration.
- Record the serialized application request size and Groq request ID in safe error details.
- Classify HTTP 413 with provider code `request_too_large` as retryable only when the serialized request is at most 64 KiB.
- Reuse the existing bounded research retry policy: two retries, three total attempts, paced by the automation worker's one-job-per-60-seconds limiter.
- Leave genuinely large client requests and unrelated 4xx responses permanent.

## Error Flow

`TopicResearchService` measures the JSON body before calling Groq. A small-payload 413 becomes `GROQ_COMPOUND_REQUEST_TOO_LARGE` with status 503 and safe diagnostics. The worker recognizes that code as a bounded research failure. After two retries, the job remains failed and visible. No Redis data is cleared automatically.

## Testing and Deployment

Tests cover the pinned version header, the small-payload 413 classification, the retry boundary, and the diagnostic allowlist. Full tests, typecheck, build, whitespace checks, Docker rebuild, deployed artifact inspection, and a live three-candidate Groq smoke test complete verification.

## Scope

Gemini image generation and TTS are unchanged. Topic-research prompts, candidate quality gates, and the existing automation limiter are unchanged.
