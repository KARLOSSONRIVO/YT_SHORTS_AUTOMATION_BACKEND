import type { ContentHistoryDocument } from "../models/content-history.model";
import type { TopicCandidate } from "./automation.types";
export class TopicRotationService {
  public violations(candidate: TopicCandidate, history: ContentHistoryDocument[], lookback = 5): string[] {
    const recent = history.slice(0, lookback); const normalize = (v:string) => v.toLowerCase().trim();
    const reasons: string[] = [];
    const recentEntities = new Set(recent.flatMap((x) => x.importantEntities.map(normalize)));
    const repeated = candidate.importantEntities.map(normalize).filter((x) => recentEntities.has(x));
    if (repeated.length) reasons.push(`recent subject rotation: ${repeated.slice(0,3).join(", ")}`);
    if (recent.slice(0,2).some((x) => x.storyFormat === (candidate as TopicCandidate & { storyFormat?: string }).storyFormat)) reasons.push("recent story-format rotation");
    return reasons;
  }
}
