import crypto from "node:crypto";
import type { ContentHistoryDocument } from "../models/content-history.model";
import type { DuplicateResult, TopicCandidate } from "./automation.types";

const STOP = new Set(["the","a","an","of","to","and","in","on","for","that","this","with","how","what","why","story"]);
export const normalizeText = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const tokens = (value: string) => new Set(normalizeText(value).split(" ").filter((x) => x.length > 2 && !STOP.has(x)));
const jaccard = (a: Set<string>, b: Set<string>) => { const union = new Set([...a, ...b]); return union.size ? [...a].filter((x) => b.has(x)).length / union.size : 0; };
const cosine = (a: number[], b: number[]) => { let dot=0, aa=0, bb=0; for(let i=0;i<Math.max(a.length,b.length);i++){const x=a[i]??0,y=b[i]??0;dot+=x*y;aa+=x*x;bb+=y*y;} return aa&&bb ? dot/Math.sqrt(aa*bb) : 0; };

export class DuplicateDetector {
  public embedding(value: string, dimensions = 96): number[] {
    const vector = Array<number>(dimensions).fill(0);
    for (const token of tokens(value)) { const digest = crypto.createHash("sha256").update(token).digest(); const index = digest.readUInt16BE(0) % dimensions; vector[index] += digest[2] % 2 ? 1 : -1; }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => Number((value / norm).toFixed(6)));
  }
  public fingerprint(value: string) { return crypto.createHash("sha256").update(normalizeText(value)).digest("hex"); }
  public compare(candidate: TopicCandidate, history: ContentHistoryDocument[], threshold: number): DuplicateResult {
    const candidateTitle = normalizeText(candidate.title); const candidateTokens = tokens(`${candidate.topic} ${candidate.title} ${candidate.keywords.join(" ")}`);
    const candidateEntities = new Set(candidate.importantEntities.map(normalizeText)); const candidateEvents = new Set(candidate.events.map(normalizeText));
    const candidateEmbedding = candidate.embedding ?? this.embedding(`${candidate.topic} ${candidate.summary} ${candidate.storyAngle}`);
    let best: DuplicateResult = { duplicate: false, score: 0, reasons: [] };
    for (const item of history) {
      const exact = candidateTitle === normalizeText(item.title) || normalizeText(candidate.topic) === item.normalizedTopic ? 1 : 0;
      const keyword = jaccard(candidateTokens, tokens(`${item.topic} ${item.title} ${item.keywords.join(" ")}`));
      const entity = jaccard(candidateEntities, new Set(item.importantEntities.map(normalizeText)));
      const event = jaccard(candidateEvents, new Set(item.events.map(normalizeText)));
      const angle = jaccard(tokens(candidate.storyAngle), tokens(item.storyAngle));
      const semantic = cosine(candidateEmbedding, item.contentEmbedding ?? []);
      const script = item.script ? jaccard(tokens(candidate.summary), tokens(item.script)) : 0;
      const sameSubjectGate = Math.max(entity * 0.65 + event * 0.35, keyword * 0.5 + semantic * 0.5);
      const score = Math.max(exact, sameSubjectGate * 0.65 + angle * 0.2 + script * 0.15);
      if (score > best.score) best = { duplicate: exact === 1 || score >= threshold, score: Number(score.toFixed(4)), matchedHistoryId: item.id, reasons: [exact ? "exact title or normalized topic" : "", entity >= .6 ? "same important entities" : "", event >= .5 ? "same event" : "", semantic >= threshold ? "high semantic similarity" : "", angle >= .65 ? "same narrative angle" : ""].filter(Boolean) };
    }
    return best;
  }
}
