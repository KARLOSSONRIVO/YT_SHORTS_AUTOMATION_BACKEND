import type { Request, Response } from "express";
import { sendSuccess } from "../../../common/utils/api-response";
import { PublishService } from "../../services/publish/publish.service";

export class PublishController {
  constructor(private readonly publishService: PublishService) {}

  public publishNow = async (request: Request, response: Response): Promise<void> => {
    const result = await this.publishService.publishClipNow(request.body);
    sendSuccess(response, result, 201);
  };
}
