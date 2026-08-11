# Groq Topic Research Migration Design

## Goal

Move automated topic research from Gemini to Groq while preserving live web research, source URLs, duplicate detection, and retry behavior. Gemini remains available only in the Python worker for image generation and text-to-speech; those paths are outside this change.

## Current State

`AutomationService` calls the backend `TopicResearchService` before it requests story generation from the Python worker. Although story generation already uses Groq, `TopicResearchService` still calls the Gemini Interactions API with Google Search and then calls Gemini Embeddings once per candidate. This separate backend call is the source of the observed Gemini Search Grounding 429 responses.

The backend already receives `GROQ_API_KEY` through its environment. The existing `DuplicateDetector` can create deterministic local embeddings, so duplicate detection does not require an external embedding provider.

## Chosen Approach

The backend will call Groq's OpenAI-compatible chat-completions endpoint directly. Topic research will use `groq/compound-mini`, restricted to its built-in `web_search` tool, so current facts and authoritative URLs remain available. Live verification found that this Groq project rejects full `groq/compound` requests with HTTP 413, while Compound Mini succeeds.

This is preferred over adding a Python-worker topic-research endpoint because it keeps the existing backend service boundary and avoids an extra internal HTTP contract. It is preferred over a plain Llama model because plain chat generation cannot reliably satisfy the requirement for current facts and verifiable source URLs.

## Configuration

The backend environment schema will expose:

- `GROQ_API_KEY`, required by topic research at runtime.
- `GROQ_TOPIC_RESEARCH_MODEL`, defaulting to `groq/compound-mini`.
- `GROQ_API_BASE_URL`, defaulting to `https://api.groq.com/openai/v1`.

The backend-only Gemini topic-research settings will be removed:

- `GEMINI_MODEL`
- `GEMINI_INTERACTIONS_URL`
- `GEMINI_EMBEDDING_MODEL`
- `GEMINI_API_BASE_URL`

`GEMINI_API_KEY` remains in the Python worker configuration for image generation and TTS. The backend will no longer require or read it for topic research.

## Request and Response Flow

1. `AutomationService` calls `TopicResearchService.generate()` with the niche profile, language, region, and recent topic/entity history.
2. `TopicResearchService` sends one request to `/chat/completions` using `groq/compound-mini`.
3. The request uses JSON object mode and enables only `web_search` through `compound_custom`.
4. The prompt retains the existing candidate schema, freshness rules, content restrictions, and requirement for two authoritative direct source URLs per candidate.
5. The service extracts `choices[0].message.content`, parses the JSON, and applies the existing minimum-candidate, source-link, and factual-confidence validation.
6. Each accepted candidate receives a local deterministic embedding from `DuplicateDetector.embedding()`.
7. The unchanged `AutomationService` selection and checkpoint flow consumes the candidates.

## Error Handling and Retries

Provider-specific errors will identify Groq rather than Gemini:

- HTTP 429 becomes `GROQ_RATE_LIMITED` with status 429.
- HTTP 5xx becomes `GROQ_UNAVAILABLE` with status 503.
- Other HTTP failures become `GROQ_REQUEST_FAILED` with the provider's safe error message.
- Missing configuration becomes `GROQ_NOT_CONFIGURED` with status 503.
- Missing or malformed completion content remains a research-response validation error.

The BullMQ custom backoff identifier and user-facing activity message will become provider-neutral so future LLM changes do not require queue-policy renaming. Existing behavior (30, 60, then 120 seconds) will remain unchanged.

## Testing

Backend tests will prove that:

- Topic research sends the expected Groq authorization header, Compound Mini model, JSON response mode, and built-in web-search tool.
- A valid mocked Groq response produces candidates with local embeddings and makes exactly one provider request.
- Groq 429 responses become actionable retryable errors.
- Invalid or insufficient candidate JSON is rejected.
- The automation queue retains the existing retry count and delay schedule under the provider-neutral backoff name.
- Existing duplicate detection continues to work with local embeddings.

The backend typecheck, complete backend test suite, production build, Docker rebuild, container health, and one controlled live topic-research request will be used for final verification. The live request must not print API keys.

## Scope Boundaries

This migration does not change:

- Groq-based story/script generation in the Python worker.
- Gemini image generation.
- Gemini TTS.
- AI animation provider routing.
- Project scheduling, topic scoring, checkpoint persistence, or publishing.

## Security

Secrets must never be logged or included in test snapshots. Because the current Groq key appeared in diagnostic terminal output, it should be rotated and the replacement stored only in the relevant `.env` files or secret manager.
