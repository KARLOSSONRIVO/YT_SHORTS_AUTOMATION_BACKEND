import axios from "axios";
import { AppError } from "../../common/errors/app-error";
import { DuplicateDetector } from "./duplicate-detector";
import type { NicheProfile, TopicCandidate } from "./automation.types";

interface GroqCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const SMALL_CLIENT_REQUEST_MAX_BYTES = 65_536;
const SCORE_KEYS = ["curiosity", "emotionalImpact", "shortFormPotential", "nicheRelevance", "originality", "retentionPotential"] as const;
const PSYCHOLOGY_NICHE_ID = "psychology";

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeText = (value: unknown): string => typeof value === "string" ? value.trim() : "";

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];

const normalizeNumberArray = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const numbers = value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  return numbers.length === value.length ? numbers : undefined;
};

const normalizeBoundedNumber = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
};

const normalizeScores = (value: unknown): TopicCandidate["scores"] => {
  const record = isRecord(value) ? value : {};
  return Object.fromEntries(SCORE_KEYS.map((key) => [key, normalizeBoundedNumber(record[key], 0.5)])) as TopicCandidate["scores"];
};

const normalizeSourceLinks = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const links = value.flatMap((source) => {
    const url = typeof source === "string"
      ? source.trim()
      : isRecord(source) && typeof source.url === "string"
        ? source.url.trim()
        : "";
    try {
      return new URL(url).protocol === "https:" ? [url] : [];
    } catch {
      return [];
    }
  });
  return [...new Set(links)];
};

const isGenericPsychologyTitle = (title: string): boolean => {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (/^(understanding|the impact of|unlocking the secrets of|the psychology of|can\b)/i.test(normalized)) return true;
  if (/\b(effect|bias|hormone|hippocampus|phenomenon|curiosity gap|cue[- ]routine[- ]reward)\b/i.test(normalized)) {
    return !/^(why|how|the reason)\b/i.test(normalized);
  }
  return false;
};

const normalizePsychologyTitle = (candidate: TopicCandidate): string => {
  const title = candidate.title.trim();
  if (!isGenericPsychologyTitle(title)) return title;

  const text = `${candidate.topic} ${candidate.title} ${candidate.summary} ${candidate.storyAngle}`.toLowerCase();
  if (text.includes("anchoring")) return "The First Number You Hear Controls Your Decision";
  if (/(body language|facial expression|nonverbal|first impression)/.test(text)) return "How Your Body Language Changes What People Think";
  if (/(sleep|hippocampus|memory|forgetting|impression)/.test(text)) return "Why Your Brain Edits What You Remember";
  if (/(confirmation bias|cognitive bias|overconfidence|decision making)/.test(text)) return "Why Your Brain Defends Bad Decisions";
  if (/(emotion|mood|oxytocin|social bond|interaction)/.test(text)) return "Why Other People's Moods Change Yours";
  if (/(habit|dopamine|routine|cue)/.test(text)) return "Why Your Brain Keeps Repeating Bad Habits";
  if (/(loss aversion|losses|losing)/.test(text)) return "Why Losing Feels Worse Than Winning Feels Good";
  if (/(social pressure|pressure)/.test(text)) return "Why You Change When Everyone Is Watching";
  if (/(familiarity|familiar)/.test(text)) return "Why Familiar People Feel Safer";
  if (/(unfinished|zeigarnik)/.test(text)) return "Why Your Brain Can't Let Go of Unfinished Tasks";
  if (/(curiosity gap|not knowing)/.test(text)) return "Why Your Brain Can't Stop Chasing Answers";
  if (/(same words|baader|seeing the same)/.test(text)) return "Why You Keep Seeing New Words Everywhere";
  return "Why Your Brain Keeps Doing This";
};

export const normalizeTopicCandidate = (value: unknown): TopicCandidate | null => {
  if (!isRecord(value)) return null;
  const scoreSource = isRecord(value.scores) ? value.scores : value;
  return {
    embedding: normalizeNumberArray(value.embedding),
    topic: normalizeText(value.topic),
    title: normalizeText(value.title),
    summary: normalizeText(value.summary),
    storyAngle: normalizeText(value.storyAngle),
    importantEntities: normalizeStringArray(value.importantEntities),
    dates: normalizeStringArray(value.dates),
    events: normalizeStringArray(value.events),
    keywords: normalizeStringArray(value.keywords),
    sourceLinks: normalizeSourceLinks(value.sourceLinks),
    disputedFacts: normalizeStringArray(value.disputedFacts),
    factualConfidence: normalizeBoundedNumber(value.factualConfidence, 0),
    scores: normalizeScores(scoreSource)
  };
};

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
        const candidates = this.parseCandidates(response.data).map((candidate) => input.profile.id === PSYCHOLOGY_NICHE_ID
          ? { ...candidate, title: normalizePsychologyTitle(candidate) }
          : candidate);
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
    const nicheStrategy = input.profile.id === "philippine_history"
      ? "Philippine-history strategy: every candidate must be explainable in 40 to 55 seconds and must be packaged around a recognizable object, place, artifact, event, or consequence. Prefer a clear mystery, unusual fact, conflict, or historical consequence that can be understood immediately. Do not lead with an unfamiliar person's name unless the title also states the event or impact that makes the person matter. Avoid broad textbook titles such as 'The History of...' and generic 'Unraveling...' wording. Titles must promise a concrete reveal, not just a biography."
      : input.profile.id === PSYCHOLOGY_NICHE_ID
        ? "Psychology strategy: every candidate must be built around a recognizable everyday behavior, relationship moment, emotion, decision, or body-language cue with a direct consequence viewers can feel personally. Use conversational Why/How titles that make the consequence clear immediately. Do not lead with academic concept names such as 'Understanding...', 'The Impact of...', 'The Psychology of...', or '[Effect/Bias/Hormone] in Decision Making'; name the psychology concept after the hook instead. Avoid creator-facing topics and abstract textbook framing. Keep the idea explainable in roughly 35 to 50 seconds, use one concrete example, and never diagnose viewers."
        : "";
    return `Research ${input.count ?? 3} factual short-video topics for ${input.profile.name}. ${sourceInstruction} ${nicheStrategy} Return only JSON with a candidates array containing topic, title, summary, storyAngle, importantEntities, dates, events, keywords, sourceLinks, disputedFacts, factualConfidence, and scores for curiosity, emotionalImpact, shortFormPotential, nicheRelevance, originality, retentionPotential. Language=${input.language}; region=${input.region}; categories=${JSON.stringify(input.profile.preferredTopicCategories)}; restrictions=${JSON.stringify(input.profile.contentRestrictions)}; avoid=${JSON.stringify(input.recentTopics.slice(0,50))}; rotate entities=${JSON.stringify(input.recentEntities.slice(0,50))}. Each candidate needs two authoritative direct HTTPS URLs. Prefer primary sources. Reject unsupported claims; never invent details or source links.`;
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
    let parsed: { candidates?: unknown } | unknown[];
    try { parsed = JSON.parse(raw) as { candidates?: unknown } | unknown[]; } catch { throw new AppError("Groq returned invalid research JSON.", 502, "RESEARCH_RESPONSE_INVALID"); }
    const returnedCandidates = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray(parsed.candidates)
        ? parsed.candidates
        : [];
    const candidates = returnedCandidates
      .map((candidate) => normalizeTopicCandidate(candidate))
      .filter((candidate): candidate is TopicCandidate => candidate !== null)
      .filter((candidate) => candidate.topic && candidate.title && candidate.sourceLinks.length >= 2 && candidate.factualConfidence >= 0.6);
    if (candidates.length < 3) throw new AppError("Research produced fewer than three adequately sourced candidates.", 422, "INSUFFICIENT_RESEARCH_CANDIDATES");
    return candidates;
  }

}
