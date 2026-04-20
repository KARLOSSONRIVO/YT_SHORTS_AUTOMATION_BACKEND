import type { Request, Response } from "express";
import { sendSuccess } from "../../../common/utils/api-response";
import { env } from "../../../config/env";
import { ChannelService } from "../../services/channel/channel.service";

export class ChannelController {
  constructor(private readonly channelService: ChannelService) {}

  public getAuthorizationUrl = async (request: Request, response: Response): Promise<void> => {
    const result = this.channelService.getConnectionUrl(request.query.userId as string);
    sendSuccess(response, result);
  };

  public connectChannel = async (request: Request, response: Response): Promise<void> => {
    const channel = await this.channelService.connectChannel(request.body.userId, request.body.code);
    sendSuccess(response, channel, 201);
  };

  public connectChannelFromCallback = async (request: Request, response: Response): Promise<void> => {
    try {
      await this.channelService.connectChannel(request.query.state as string, request.query.code as string);
      response.redirect(302, `${env.FRONTEND_APP_URL}/channel/connected?status=success`);
    } catch {
      response.redirect(302, `${env.FRONTEND_APP_URL}/channel/connected?status=error`);
    }
  };

  public listChannels = async (request: Request, response: Response): Promise<void> => {
    const channels = await this.channelService.listChannels(request.query.userId as string);
    sendSuccess(response, channels);
  };

  public disconnectChannel = async (request: Request, response: Response): Promise<void> => {
    const channel = await this.channelService.disconnectChannel(
      request.query.userId as string,
      String(request.params.channelId)
    );
    sendSuccess(response, channel);
  };
}
