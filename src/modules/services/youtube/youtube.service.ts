import type { YouTubeTokenSet } from "../../../infrastructure/youtube/youtube.client";
import { YouTubeClient } from "../../../infrastructure/youtube/youtube.client";

export class YouTubeService {
  constructor(private readonly youTubeClient: YouTubeClient) {}

  public getAuthorizationUrl(userId: string) {
    return this.youTubeClient.createConsentUrl(userId);
  }

  public exchangeCodeForTokens(code: string): Promise<YouTubeTokenSet> {
    return this.youTubeClient.exchangeCodeForTokens(code);
  }

  public fetchChannelProfile(tokens: YouTubeTokenSet) {
    return this.youTubeClient.fetchChannelProfile(tokens);
  }

  public revokeToken(token: string) {
    return this.youTubeClient.revokeToken(token);
  }

  public uploadShort(input: {
    tokens: YouTubeTokenSet;
    title: string;
    description: string;
    privacyStatus: "private" | "public" | "unlisted";
    videoPath: string;
  }) {
    return this.youTubeClient.uploadShort(input);
  }
}
