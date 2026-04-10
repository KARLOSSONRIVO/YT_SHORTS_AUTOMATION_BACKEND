import fs from "node:fs";
import { google, type youtube_v3 } from "googleapis";
import type { Credentials } from "google-auth-library";

export interface YouTubeClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface YouTubeTokenSet {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
  token_type?: string | null;
}

export class YouTubeClient {
  private readonly oauthClient;

  constructor(config: YouTubeClientConfig) {
    this.oauthClient = new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
  }

  public createConsentUrl(state: string): string {
    return this.oauthClient.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly"
      ],
      prompt: "consent",
      state
    });
  }

  public async exchangeCodeForTokens(code: string): Promise<YouTubeTokenSet> {
    const { tokens } = await this.oauthClient.getToken(code);
    return tokens;
  }

  private toCredentials(tokens: YouTubeTokenSet): Credentials {
    return {
      access_token: tokens.access_token ?? undefined,
      refresh_token: tokens.refresh_token ?? undefined,
      expiry_date: tokens.expiry_date ?? undefined,
      scope: tokens.scope ?? undefined,
      token_type: tokens.token_type ?? undefined
    };
  }

  public async fetchChannelProfile(tokens: YouTubeTokenSet): Promise<youtube_v3.Schema$Channel> {
    this.oauthClient.setCredentials(this.toCredentials(tokens));
    const youtube = google.youtube({ version: "v3", auth: this.oauthClient });
    const response = await youtube.channels.list({
      part: ["snippet", "contentDetails"],
      mine: true
    });

    const channel = response.data.items?.[0];
    if (!channel) {
      throw new Error("No YouTube channel profile returned for the connected account.");
    }

    return channel;
  }

  public async uploadShort(input: {
    tokens: YouTubeTokenSet;
    title: string;
    description: string;
    privacyStatus: "private" | "public" | "unlisted";
    videoPath: string;
  }): Promise<youtube_v3.Schema$Video> {
    this.oauthClient.setCredentials(this.toCredentials(input.tokens));
    const youtube = google.youtube({ version: "v3", auth: this.oauthClient });

    const response = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: input.title,
          description: input.description,
          categoryId: "22"
        },
        status: {
          privacyStatus: input.privacyStatus
        }
      },
      media: {
        body: fs.createReadStream(input.videoPath)
      }
    });

    if (!response.data) {
      throw new Error("YouTube upload completed without a response payload.");
    }

    return response.data;
  }
}
