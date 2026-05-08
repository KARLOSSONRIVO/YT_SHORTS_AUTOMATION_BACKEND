import type { Request, Response } from "express";
import { getAuthenticatedUser } from "../../../common/middlewares/require-auth.middleware";
import { sendSuccess } from "../../../common/utils/api-response";
import { env } from "../../../config/env";
import { ChannelService } from "../../services/channel/channel.service";

export class ChannelController {
  constructor(private readonly channelService: ChannelService) {}

  public getAuthorizationUrl = async (request: Request, response: Response): Promise<void> => {
    const result = this.channelService.getConnectionUrl(getAuthenticatedUser(request).id);
    sendSuccess(response, result);
  };

  public connectChannel = async (request: Request, response: Response): Promise<void> => {
    const channel = await this.channelService.connectChannel(getAuthenticatedUser(request).id, request.body.code);
    sendSuccess(response, channel, 201);
  };

  public connectChannelFromCallback = async (request: Request, response: Response): Promise<void> => {
    try {
      if (request.query.error || !request.query.state || !request.query.code) {
        response.redirect(302, `${env.FRONTEND_APP_URL}/channel/connected?status=error`);
        return;
      }

      const userId = this.parseOAuthState(String(request.query.state));
      await this.channelService.connectChannel(userId, request.query.code as string);
      response.redirect(302, `${env.FRONTEND_APP_URL}/channel/connected?status=success`);
    } catch {
      response.redirect(302, `${env.FRONTEND_APP_URL}/channel/connected?status=error`);
    }
  };

  public listChannels = async (request: Request, response: Response): Promise<void> => {
    const channels = await this.channelService.listChannels(getAuthenticatedUser(request).id);
    sendSuccess(response, channels);
  };

  public disconnectChannel = async (request: Request, response: Response): Promise<void> => {
    const channel = await this.channelService.disconnectChannel(getAuthenticatedUser(request).id, String(request.params.channelId));
    sendSuccess(response, channel);
  };

  private parseOAuthState(rawState: string): string {
    if (rawState.includes(":")) {
      const [, ...userIdParts] = rawState.split(":");
      const userId = userIdParts.join(":").trim();
      if (userId) {
        return userId;
      }
    }

    return rawState;
  }
}
