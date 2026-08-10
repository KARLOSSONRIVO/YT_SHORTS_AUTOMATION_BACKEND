# Groq Research Resilience Design

## Goal

Prevent automated topic research from exhausting Groq Compound Mini's effective per-minute token capacity, and recover safely when Groq returns a temporary rate limit or malformed research output.

## Evidence

Two automation projects reached Groq about 32 seconds apart. The second received HTTP 429, retried after the fixed 30-second delay, reached Groq successfully, and then failed permanently because the response was invalid JSON. Automation currently requests eight detailed, sourced candidates, uses a fixed backoff that ignores Groq's `retry-after`, and treats every non-rate-limit automation error as unrecoverable.

## Approaches

### Selected: reduce, pace, and retry narrowly

- Request exactly three candidates, matching the existing minimum-quality gate and the live request that completed successfully.
- Apply a BullMQ limiter of one automation job per 60 seconds only to the automation worker.
- Prefer a numeric Groq `retry-after` header over the fallback 30/60/120-second backoff.
- Retry research response-shape failures at most two additional times, while preserving long-lived retries for genuine HTTP 429 failures.
- Log structured Groq error and quota metadata without logging the API key or generated research content.

This keeps current web research while controlling the two observed failure modes.

### Rejected: disable web search

This lowers token use but removes current-fact verification and source discovery, which are core requirements for topic research.

### Rejected: rely only on a higher Groq plan

More quota can reduce 429 frequency but does not fix oversized prompts, malformed JSON handling, fixed backoff, or missing diagnostics.

## Data Flow

1. The scheduler or Generate Now queues an automation job.
2. The automation worker admits at most one job per 60 seconds.
3. `TopicResearchService` asks Compound Mini for three sourced candidates using one web search.
4. HTTP 429 errors retain Groq's provider message, `retry-after`, and rate-limit headers. BullMQ uses `retry-after` when present.
5. Empty, invalid, or insufficient research responses are retried only while the job has fewer than three total attempts.
6. Other validation errors remain unrecoverable.
7. Worker failure logs include safe structured provider and quota fields.

## Error Handling

- `GROQ_RATE_LIMITED`: retry according to `retry-after`, otherwise 30/60/120 seconds.
- `RESEARCH_RESPONSE_INVALID`: retry up to three total job attempts with a 60-second research-response delay.
- `INSUFFICIENT_RESEARCH_CANDIDATES`: retry up to three total job attempts with the same delay.
- Permanent application errors: stop immediately with `UnrecoverableError`.
- A final malformed response remains failed and visible after the bounded retries.

## Testing

- Assert the default prompt requests exactly three candidates.
- Assert numeric `retry-after` overrides fallback backoff and invalid values do not.
- Assert the automation-only limiter is one job per 60 seconds.
- Assert research response errors are recognized and bounded to three attempts.
- Assert Groq quota metadata is extracted for logging without secrets.
- Run the full backend tests, typecheck, production build, Docker rebuild, and live three-candidate research smoke test.

## Scope

Gemini image generation and TTS are unchanged. Redis data and existing failed jobs are not deleted automatically.
