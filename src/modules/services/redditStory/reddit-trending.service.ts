import { AppError } from "../../../common/errors/app-error";
import { ProjectRepository } from "../../repositories/project.repository";

interface RedditListingChild {
  data?: {
    id?: string;
    title?: string;
    selftext?: string;
    permalink?: string;
    subreddit?: string;
    author?: string;
    score?: number;
    over_18?: boolean;
    stickied?: boolean;
    is_self?: boolean;
  };
}

interface RedditListingResponse {
  data?: {
    after?: string | null;
    children?: RedditListingChild[];
  };
}

export interface TrendingRedditPost {
  postId: string;
  permalink: string;
  title: string;
  body: string;
  subreddit: string;
  author?: string;
  score?: number;
  fetchedAt: Date;
}

export class RedditTrendingService {
  private static readonly REDDIT_BASE_URL = "https://www.reddit.com";
  private static readonly USER_AGENT = "ShortsStudio/1.0 (reddit-story-generator)";
  private static readonly REQUEST_TIMEOUT_MS = 12_000;
  private static readonly MAX_SHORT_DURATION_SECONDS = 180;
  private static readonly ESTIMATED_WORDS_PER_SECOND = 1.75;
  private static readonly ESTIMATED_OVERHEAD_SECONDS = 10;
  private static readonly DEFAULT_STORY_SUBREDDITS = [
    "AskReddit",
    "tifu",
    "confession",
    "offmychest",
    "TrueOffMyChest",
    "relationships"
  ] as const;

  constructor(private readonly projectRepository: ProjectRepository) {}

  public async pickTrendingPost(input: { subreddit?: string; topic?: string }): Promise<TrendingRedditPost> {
    const usedPostIds = await this.loadUsedPostIds();
    const usedPermalinks = await this.loadUsedPermalinks();
    const candidates: TrendingRedditPost[] = [];

    const normalizedTopic = this.normalizeTopic(input.topic);
    if (normalizedTopic) {
      await this.collectTopicCandidates({
        topic: normalizedTopic,
        usedPermalinks,
        usedPostIds,
        candidates
      });
    } else {
      const subreddits = this.resolveSubreddits(input.subreddit);
      for (const subreddit of subreddits) {
        await this.collectTrendingSubredditCandidates({
          subreddit,
          usedPermalinks,
          usedPostIds,
          candidates
        });
      }
    }

    const freshestCandidate = candidates
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .at(0);

    if (freshestCandidate) {
      return freshestCandidate;
    }

    throw new AppError(
      normalizedTopic
        ? `No fresh trending Reddit stories were available for topic "${normalizedTopic}".`
        : input.subreddit
        ? `No fresh trending Reddit stories were available for r/${this.normalizeSubreddit(input.subreddit)}.`
        : "No fresh trending Reddit stories were available in the default story feed.",
      409,
      "NO_FRESH_REDDIT_STORY"
    );
  }

  private async collectTrendingSubredditCandidates(input: {
    subreddit: string;
    usedPostIds: Set<string>;
    usedPermalinks: Set<string>;
    candidates: TrendingRedditPost[];
  }) {
    let after: string | null | undefined = null;
    for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
      const listing = await this.fetchTrendingListing({ subreddit: input.subreddit, after: after ?? undefined });
      const children = listing.data?.children ?? [];

      for (const child of children) {
        const candidate = this.normalizeListingChild(child, input.subreddit);
        if (!candidate) {
          continue;
        }

        if (input.usedPostIds.has(candidate.postId) || input.usedPermalinks.has(candidate.permalink)) {
          continue;
        }

        if (this.estimatedNarrationDurationSeconds(candidate) > RedditTrendingService.MAX_SHORT_DURATION_SECONDS) {
          continue;
        }

        input.candidates.push(candidate);
      }

      after = listing.data?.after;
      if (!after) {
        break;
      }
    }
  }

  private async collectTopicCandidates(input: {
    topic: string;
    usedPostIds: Set<string>;
    usedPermalinks: Set<string>;
    candidates: TrendingRedditPost[];
  }) {
    for (const subreddit of RedditTrendingService.DEFAULT_STORY_SUBREDDITS) {
      let after: string | null | undefined = null;
      for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
        const listing = await this.fetchTopicListing({
          topic: input.topic,
          subreddit,
          after: after ?? undefined
        });
        const children = listing.data?.children ?? [];

        for (const child of children) {
          const candidate = this.normalizeListingChild(child, subreddit);
          if (!candidate) {
            continue;
          }

          if (!this.matchesTopic(candidate, input.topic)) {
            continue;
          }

          if (input.usedPostIds.has(candidate.postId) || input.usedPermalinks.has(candidate.permalink)) {
            continue;
          }

          if (this.estimatedNarrationDurationSeconds(candidate) > RedditTrendingService.MAX_SHORT_DURATION_SECONDS) {
            continue;
          }

          input.candidates.push(candidate);
        }

        after = listing.data?.after;
        if (!after) {
          break;
        }
      }
    }
  }

  private normalizeSubreddit(value?: string) {
    const trimmed = (value ?? "AskReddit").trim();
    return trimmed.replace(/^r\//i, "") || "AskReddit";
  }

  private resolveSubreddits(value?: string) {
    if (value?.trim()) {
      return [this.normalizeSubreddit(value)];
    }

    return [...RedditTrendingService.DEFAULT_STORY_SUBREDDITS];
  }

  private normalizeTopic(value?: string) {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private async loadUsedPostIds() {
    const projects = await this.projectRepository.findMany({
      projectType: "faceless_story",
      facelessSource: "reddit_trending",
      "redditSource.postId": { $exists: true }
    });

    return new Set(
      projects
        .map((project) => project.redditSource?.postId?.trim())
        .filter((postId): postId is string => Boolean(postId))
    );
  }

  private async loadUsedPermalinks() {
    const projects = await this.projectRepository.findMany({
      projectType: "faceless_story",
      facelessSource: "reddit_trending",
      "redditSource.permalink": { $exists: true }
    });

    return new Set(
      projects
        .map((project) => project.redditSource?.permalink?.trim())
        .filter((permalink): permalink is string => Boolean(permalink))
    );
  }

  private async fetchTrendingListing(input: { subreddit: string; after?: string }) {
    const url = new URL(`/r/${input.subreddit}/top.json`, RedditTrendingService.REDDIT_BASE_URL);
    url.searchParams.set("limit", "25");
    url.searchParams.set("t", "day");
    url.searchParams.set("raw_json", "1");
    if (input.after) {
      url.searchParams.set("after", input.after);
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), RedditTrendingService.REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": RedditTrendingService.USER_AGENT,
          Accept: "application/json"
        },
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new AppError(
          `Reddit trending fetch failed with status ${response.status}.`,
          502,
          "REDDIT_TRENDING_FETCH_FAILED"
        );
      }

      return (await response.json()) as RedditListingResponse;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : "Unknown Reddit fetch error.";
      throw new AppError(message, 502, "REDDIT_TRENDING_FETCH_FAILED");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetchTopicListing(input: { topic: string; subreddit: string; after?: string }) {
    const url = new URL("/search.json", RedditTrendingService.REDDIT_BASE_URL);
    url.searchParams.set("q", `${input.topic} subreddit:${input.subreddit}`);
    url.searchParams.set("sort", "top");
    url.searchParams.set("t", "day");
    url.searchParams.set("type", "link");
    url.searchParams.set("limit", "25");
    url.searchParams.set("raw_json", "1");
    if (input.after) {
      url.searchParams.set("after", input.after);
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), RedditTrendingService.REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": RedditTrendingService.USER_AGENT,
          Accept: "application/json"
        },
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new AppError(
          `Reddit topic search failed with status ${response.status}.`,
          502,
          "REDDIT_TOPIC_SEARCH_FAILED"
        );
      }

      return (await response.json()) as RedditListingResponse;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : "Unknown Reddit search error.";
      throw new AppError(message, 502, "REDDIT_TOPIC_SEARCH_FAILED");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private normalizeListingChild(child: RedditListingChild, fallbackSubreddit: string): TrendingRedditPost | null {
    const data = child.data;
    if (!data?.id || !data.permalink || !data.title || !data.selftext) {
      return null;
    }

    if (data.over_18 || data.stickied || data.is_self === false) {
      return null;
    }

    const title = this.cleanText(data.title);
    const body = this.cleanText(data.selftext);

    if (title.length < 8 || body.length < 120) {
      return null;
    }

    return {
      postId: data.id,
      permalink: `${RedditTrendingService.REDDIT_BASE_URL}${data.permalink}`,
      title,
      body,
      subreddit: data.subreddit?.trim() || fallbackSubreddit,
      author: data.author?.trim(),
      score: typeof data.score === "number" ? data.score : undefined,
      fetchedAt: new Date()
    };
  }

  private cleanText(value: string) {
    return value
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private matchesTopic(candidate: TrendingRedditPost, topic: string) {
    const haystack = `${candidate.title}\n${candidate.body}\n${candidate.subreddit}`.toLowerCase();
    return topic
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((token) => haystack.includes(token));
  }

  private estimatedNarrationDurationSeconds(candidate: Pick<TrendingRedditPost, "title" | "body">) {
    const totalWords = this.wordCount(`${candidate.title} ${candidate.body}`);
    return totalWords / RedditTrendingService.ESTIMATED_WORDS_PER_SECOND + RedditTrendingService.ESTIMATED_OVERHEAD_SECONDS;
  }

  private wordCount(value: string) {
    return value
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean).length;
  }
}
