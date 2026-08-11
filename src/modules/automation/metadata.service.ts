import type { NicheProfile, TopicCandidate } from "./automation.types";
export class PlatformMetadataService {
  public build(candidate: TopicCandidate, profile: NicheProfile, platform: string) {
    const hashtags = [...new Set([...profile.hashtagCategories, ...candidate.keywords.slice(0,4)])].map((x) => `#${x.replace(/[^a-zA-Z0-9]/g, "")}`).filter((x) => x.length > 1);
    const titleLimit = platform === "youtube" ? 100 : 150;
    const title = candidate.title.replace(/[\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().slice(0, titleLimit);
    return { title, description: `${candidate.summary}\n\nSources are recorded in the content history.\n\n${hashtags.join(" ")}`.slice(0, 5000), hashtags, keywords: candidate.keywords };
  }
}
