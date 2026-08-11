import axios from "axios";
import { AppError } from "../../common/errors/app-error";
import { DuplicateDetector } from "./duplicate-detector";
import type { NicheProfile, TopicCandidate } from "./automation.types";

interface GroqCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const SMALL_CLIENT_REQUEST_MAX_BYTES = 65_536;

export class TopicResearchService {
  private readonly duplicate = new DuplicateDetector();

  constructor(
    private readonly apiKey: string | undefined,
    private readonly model: string,
    private readonly baseUrl: string,
    private readonly fallbackModels: string[] = []
  ) {}

  public async generate(input: { profile: NicheProfile; language: string; region: string; recentTopics: string[]; recentEntities: string[]; count?: number }): Promise<TopicCandidate[]> {
    if (!this.apiKey) throw new AppError("GROQ_API_KEY is required for automated topic research.", 503, "GROQ_NOT_CONFIGURED");
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const models = [...new Set([this.model, ...this.fallbackModels].map((model) => model.trim()).filter(Boolean))];
    for (const [index, model] of models.entries()) {
      try {
        const response = await this.post(url, this.buildRequest(model, input));
        const candidates = this.parseCandidates(response.data);
        return candidates.map((candidate) => ({
          ...candidate,
          embedding: this.duplicate.embedding(`${candidate.topic}\n${candidate.summary}\n${candidate.storyAngle}`)
        }));
      } catch (error) {
        const hasFallback = index < models.length - 1;
        if (hasFallback && error instanceof AppError && error.code === "GROQ_RATE_LIMITED") continue;
        throw error;
      }
    }
    throw new AppError("No Groq topic-research model is configured.", 503, "GROQ_NOT_CONFIGURED");
  }

  private buildRequest(model: string, input: { profile: NicheProfile; language: string; region: string; recentTopics: string[]; recentEntities: string[]; count?: number }) {
    const usesCompound = model.startsWith("groq/compound");
    const request: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: this.buildPrompt(input, usesCompound) }],
      temperature: 0.65,
      max_completion_tokens: 5000,
      response_format: { type: "json_object" }
    };
    if (usesCompound) request.compound_custom = { tools: { enabled_tools: ["web_search"] } };
    if (model === "qwen/qwen3.6-27b") request.reasoning_effort = "none";
    return request;
  }

  private async post(url: string, body: unknown) {
    const requestBodyBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
    try {
      return await axios.post<GroqCompletionResponse>(url, body, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Groq-Model-Version": "2025-07-23"
        },
        timeout: 120000
      });
    } catch (error) {
      if (!axios.isAxiosError(error)) throw error;
      const status = error.response?.status ?? 502;
      const data = error.response?.data as { error?: { message?: string; code?: string; type?: string } } | undefined;
      const providerMessage = data?.error?.message;
      const headers = error.response?.headers;
      const providerCode = data?.error?.code ?? data?.error?.type;
      const details = {
        provider: "groq",
        providerCode,
        providerMessage,
        retryAfter: headers?.["retry-after"],
        limitRequests: headers?.["x-ratelimit-limit-requests"],
        remainingRequests: headers?.["x-ratelimit-remaining-requests"],
        resetRequests: headers?.["x-ratelimit-reset-requests"],
        limitTokens: headers?.["x-ratelimit-limit-tokens"],
        remainingTokens: headers?.["x-ratelimit-remaining-tokens"],
        resetTokens: headers?.["x-ratelimit-reset-tokens"]
      };
      if (status === 413 && providerCode === "request_too_large" && requestBodyBytes <= SMALL_CLIENT_REQUEST_MAX_BYTES) {
        throw new AppError(
          "Groq Compound temporarily rejected a small research request. Automatic retries will continue.",
          503,
          "GROQ_COMPOUND_REQUEST_TOO_LARGE",
          { ...details, requestId: headers?.["x-request-id"], requestBodyBytes }
        );
      }
      if (status === 429) throw new AppError(
        "Groq is temporarily rate-limited. Automatic retries will continue; try Generate Now again in a few minutes if they are exhausted.",
        429, "GROQ_RATE_LIMITED", details
      );
      if (status >= 500) throw new AppError("Groq is temporarily unavailable. Automatic retries will continue.", 503, "GROQ_UNAVAILABLE", details);
      throw new AppError(providerMessage ?? "Groq request failed.", status, "GROQ_REQUEST_FAILED", details);
    }
  }
  private buildPrompt(input: { profile: NicheProfile; language: string; region: string; recentTopics: string[]; recentEntities: string[]; count?: number }, hasLiveWebSearch = true) {
    const sourceInstruction = hasLiveWebSearch
      ? "Use web search to verify current facts."
      : "Live web search is unavailable. Use only high-confidence established facts, do not claim live verification, and do not invent details or source links.";
    return `Research ${input.count ?? 3} factual short-video topics for ${input.profile.name}. ${sourceInstruction} Return only JSON with a candidates array containing topic, title, summary, storyAngle, importantEntities, dates, events, keywords, sourceLinks, disputedFacts, factualConfidence, and scores for curiosity, emotionalImpact, shortFormPotential, nicheRelevance, originality, retentionPotential. Language=${input.language}; region=${input.region}; categories=${JSON.stringify(input.profile.preferredTopicCategories)}; restrictions=${JSON.stringify(input.profile.contentRestrictions)}; avoid=${JSON.stringify(input.recentTopics.slice(0,50))}; rotate entities=${JSON.stringify(input.recentEntities.slice(0,50))}. Each candidate needs two authoritative direct HTTPS URLs. Prefer primary sources. Reject unsupported claims; never invent details or source links.`;
  }

  private parseCandidates(value: GroqCompletionResponse): TopicCandidate[] {
    const content = value.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) throw new AppError("Groq returned no topic research content.", 502, "RESEARCH_RESPONSE_INVALID");
    const objectStart = content.indexOf("{");
    const arrayStart = content.indexOf("[");
    const starts = [objectStart, arrayStart].filter((index) => index >= 0);
    const start = starts.length ? Math.min(...starts) : -1;
    const closing = start >= 0 && content[start] === "{" ? "}" : "]";
    const end = start >= 0 ? content.lastIndexOf(closing) : -1;
    const raw = start >= 0 && end > start ? content.slice(start, end + 1) : content;
    type RawTopicCandidate = Omit<TopicCandidate, "sourceLinks"> & { sourceLinks?: unknown };
    let parsed: { candidates?: RawTopicCandidate[] } | RawTopicCandidate[];
    try { parsed = JSON.parse(raw) as { candidates?: RawTopicCandidate[] } | RawTopicCandidate[]; } catch { throw new AppError("Groq returned invalid research JSON.", 502, "RESEARCH_RESPONSE_INVALID"); }
    const returnedCandidates = Array.isArray(parsed) ? parsed : parsed.candidates ?? [];
    const candidates = returnedCandidates
      .map((candidate): TopicCandidate => ({ ...candidate, sourceLinks: this.normalizeSourceLinks(candidate.sourceLinks) }))
      .filter((candidate) => candidate.topic && candidate.title && candidate.sourceLinks.length >= 2 && candidate.factualConfidence >= 0.6);
    if (candidates.length < 3) throw new AppError("Research produced fewer than three adequately sourced candidates.", 422, "INSUFFICIENT_RESEARCH_CANDIDATES");
    return candidates;
  }

  private normalizeSourceLinks(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const links = value.flatMap((source) => {
      const url = typeof source === "string"
        ? source.trim()
        : source && typeof source === "object" && "url" in source && typeof source.url === "string"
          ? source.url.trim()
          : "";
      try {
        return new URL(url).protocol === "https:" ? [url] : [];
      } catch {
        return [];
      }
    });
    return [...new Set(links)];
  }
}
