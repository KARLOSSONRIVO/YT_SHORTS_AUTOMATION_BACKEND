import type { ContentHistoryDocument } from "../models/content-history.model";
import type { TopicCandidate } from "./automation.types";
export class TopicRotationService {
  public violations(candidate: TopicCandidate, history: ContentHistoryDocument[], lookback = 5): string[] {
    const recent = history.slice(0, lookback); const normalize = (v:string) => v.toLowerCase().trim();
    const reasons: string[] = [];
    const candidateSubject = normalize(candidate.importantEntities[0] || candidate.topic);
    const recentSubjects = new Set(recent.map((x) => normalize(x.importantEntities[0] || x.topic)));
    if (candidateSubject && recentSubjects.has(candidateSubject)) reasons.push(`recent subject rotation: ${candidateSubject}`);
    if (recent.slice(0,2).some((x) => x.storyFormat === (candidate as TopicCandidate & { storyFormat?: string }).storyFormat)) reasons.push("recent story-format rotation");
    return reasons;
  }
}
