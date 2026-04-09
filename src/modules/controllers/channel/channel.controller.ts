import type { Request, Response } from "express";
import { sendSuccess } from "../../../common/utils/api-response";
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
    const channel = await this.channelService.connectChannel(
      request.query.state as string,
      request.query.code as string
    );
    sendSuccess(response, channel, 201);
  };

  public listChannels = async (request: Request, response: Response): Promise<void> => {
    const channels = await this.channelService.listChannels(request.query.userId as string);
    sendSuccess(response, channels);
  };
}
