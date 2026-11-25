import type { Request, Response } from "express";
import { getAuthenticatedUser } from "../../../common/middlewares/require-auth.middleware";
import { sendSuccess } from "../../../common/utils/api-response";
import type { ClipService } from "../../services/clip/clip.service";
import type { ProjectService } from "../../services/project/project.service";
import { resolveSubtitlePreferences } from "../../services/subtitle/subtitle-preferences";
import { SubtitleService } from "../../services/subtitle/subtitle.service";

export class SubtitleController {
  constructor(
    private readonly subtitleService: SubtitleService,
    private readonly clipService: ClipService,
    private readonly projectService: ProjectService
  ) {}

  public getClipSubtitle = async (request: Request, response: Response): Promise<void> => {
    const clip = await this.clipService.getClipOrThrow(String(request.params.clipId));
    const project = await this.projectService.getOwnedProjectOrThrow(String(clip.projectId), getAuthenticatedUser(request).id);
    const subtitle = await this.subtitleService.getClipSubtitle(clip);
    sendSuccess(response, { ...subtitle, preferences: resolveSubtitlePreferences(project.subtitlePreferences, clip) });
  };
}
