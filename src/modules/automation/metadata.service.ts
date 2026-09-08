import type { NicheProfile, TopicCandidate } from "./automation.types";
import { sanitizeUploadTitle, normalizeHashtags } from "../services/publish/upload-text";
export class PlatformMetadataService {
  public build(candidate: TopicCandidate, profile: NicheProfile, platform: string) {
    const isPhilippineHistory = profile.id === "philippine_history";
    const tags = normalizeHashtags(
      [...profile.hashtagCategories, ...candidate.keywords.slice(0, isPhilippineHistory ? 1 : 4)],
      { ensureShorts: true, max: isPhilippineHistory ? 5 : 30 }
    );
    const hashtags = tags.map((tag) => `#${tag}`);
    const titleLimit = platform === "youtube" ? 100 : 150;
    const title = sanitizeUploadTitle(candidate.title, "YouTube Short", titleLimit);
    const seriesLine = isPhilippineHistory ? "Hidden Philippine History" : undefined;
    const description = [seriesLine, candidate.summary, "Sources are recorded in the content history.", hashtags.join(" ")]
      .filter((value): value is string => Boolean(value))
      .join("\n\n");
    return { title, description: description.slice(0, 5000), hashtags, keywords: candidate.keywords };
  }
}
