import { NotFoundError } from "../../../common/errors/not-found-error";
import { ChannelRepository } from "../../repositories/channel.repository";
import { YouTubeService } from "../youtube/youtube.service";

export class ChannelService {
  constructor(
    private readonly channelRepository: ChannelRepository,
    private readonly youTubeService: YouTubeService
  ) {}

  public getConnectionUrl(userId: string) {
    return {
      authorizationUrl: this.youTubeService.getAuthorizationUrl(userId)
    };
  }

  public async connectChannel(userId: string, code: string) {
    const tokens = await this.youTubeService.exchangeCodeForTokens(code);
    const profile = await this.youTubeService.fetchChannelProfile(tokens);
    const channelId = profile.id;

    if (!channelId || !profile.snippet?.title) {
      throw new NotFoundError("Unable to resolve YouTube channel information.");
    }

    return this.channelRepository.createOrUpdateByExternalChannelId(userId, channelId, {
      userId: userId as never,
      provider: "youtube",
      externalChannelId: channelId,
      title: profile.snippet.title,
      accessToken: tokens.access_token ?? undefined,
      refreshToken: tokens.refresh_token ?? undefined,
      tokenType: tokens.token_type ?? undefined,
      scope: tokens.scope ?? undefined,
      tokenExpiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      status: "connected"
    });
  }

  public listChannels(userId: string) {
    return this.channelRepository.findByUserId(userId);
  }

  public async getChannelOrThrow(channelId: string) {
    const channel = await this.channelRepository.findById(channelId);
    if (!channel) {
      throw new NotFoundError("Channel not found.", { channelId });
    }

    return channel;
  }
}
