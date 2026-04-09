import type { Request, Response } from "express";
import { sendSuccess } from "../../../common/utils/api-response";
import { ClipService } from "../../services/clip/clip.service";
import { RenderService } from "../../services/render/render.service";

export class ClipController {
  constructor(
    private readonly clipService: ClipService,
    private readonly renderService: RenderService
  ) {}

  public listClips = async (request: Request, response: Response): Promise<void> => {
    const clips = await this.clipService.listByProjectId(request.query.projectId as string);
    sendSuccess(response, clips);
  };

  public reviewClip = async (request: Request, response: Response): Promise<void> => {
    const clip = await this.clipService.reviewClip(request.params.clipId, request.body.reviewStatus);

    if (request.body.reviewStatus === "approved" && clip) {
      await this.renderService.queueRender(clip.id, `${clip.projectId}`);
    }

    sendSuccess(response, clip);
  };
}
