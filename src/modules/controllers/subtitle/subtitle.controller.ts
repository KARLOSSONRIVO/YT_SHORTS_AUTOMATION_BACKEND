import type { Request, Response } from "express";
import { sendSuccess } from "../../../common/utils/api-response";
import { SubtitleService } from "../../services/subtitle/subtitle.service";

export class SubtitleController {
  constructor(private readonly subtitleService: SubtitleService) {}

  public getClipSubtitle = async (request: Request, response: Response): Promise<void> => {
    const subtitle = await this.subtitleService.getClipSubtitle(request.params.clipId);
    sendSuccess(response, subtitle);
  };
}
