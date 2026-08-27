import type { NicheProfile, TopicCandidate } from "./automation.types";
import { sanitizeUploadTitle, normalizeHashtags } from "../services/publish/upload-text";
export class PlatformMetadataService {
  public build(candidate: TopicCandidate, profile: NicheProfile, platform: string) {
    const tags = normalizeHashtags([...profile.hashtagCategories, ...candidate.keywords.slice(0, 4)], { ensureShorts: true });
    const hashtags = tags.map((tag) => `#${tag}`);
    const titleLimit = platform === "youtube" ? 100 : 150;
    const title = sanitizeUploadTitle(candidate.title, "YouTube Short", titleLimit);
    return { title, description: `${candidate.summary}\n\nSources are recorded in the content history.\n\n${hashtags.join(" ")}`.slice(0, 5000), hashtags, keywords: candidate.keywords };
  }
}
