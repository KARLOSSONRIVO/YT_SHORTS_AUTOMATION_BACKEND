# Groq Research Model Fallbacks Design

## Goal

Keep `groq/compound-mini` as the primary topic-research system, but avoid pausing automation when Compound Mini's underlying Llama 3.3 quota is exhausted. Retry the research request with `qwen/qwen3.6-27b`, then with `llama-3.1-8b-instant`, before returning the existing rate-limit error to BullMQ.

## Model Chain

1. `groq/compound-mini` uses built-in web search and remains the primary research path.
2. `qwen/qwen3.6-27b` is attempted only when Compound Mini returns HTTP 429.
3. `llama-3.1-8b-instant` is attempted only when Qwen also returns HTTP 429.
4. A final HTTP 429 preserves `GROQ_RATE_LIMITED`, allowing the existing delayed queue retry policy to continue.

Only Compound Mini can use Groq's built-in web-search tool. Direct-model fallbacks must omit `compound_custom`; Qwen must use `reasoning_effort: "none"` so its output budget is spent on the required JSON instead of hidden reasoning. The fallback prompt must explicitly state that live web search is unavailable and prohibit claims of live verification.

## Configuration

- `GROQ_TOPIC_RESEARCH_MODEL=groq/compound-mini`
- `GROQ_TOPIC_RESEARCH_FALLBACK_MODEL=qwen/qwen3.6-27b`
- `GROQ_TOPIC_RESEARCH_SECONDARY_FALLBACK_MODEL=llama-3.1-8b-instant`

The application container passes the two fallback values to `TopicResearchService`. The service removes duplicate or blank model IDs before sending requests.

## Error Handling

Fallback is deliberately limited to HTTP 429. Authentication failures, invalid requests, malformed model output, and application validation failures remain visible and do not silently degrade to another model. If a fallback succeeds, candidate parsing and duplicate embeddings remain unchanged.

## Testing

Automated tests will verify the exact model order, Compound-only web-search payload, Qwen non-thinking payload, Llama payload, successful fallback parsing, final rate-limit propagation, environment defaults, and dependency wiring.

