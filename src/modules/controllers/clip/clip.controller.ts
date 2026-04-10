import type { Request, Response } from "express";
import { sendSuccess } from "../../../common/utils/api-response";
import { ClipService } from "../../services/clip/clip.service";
import { RenderService } from "../../services/render/render.service";
import { SourceVideoService } from "../../services/sourceVideo/source-video.service";

export class ClipController {
  constructor(
    private readonly clipService: ClipService,
    private readonly renderService: RenderService,
    private readonly sourceVideoService: SourceVideoService
  ) {}

  private serializeClip = (
    request: Request,
    clip: { toObject(): Record<string, unknown> } | null,
    sourceVideoStorageKey?: string
  ) => {
    if (!clip) {
      return clip;
    }

    const serializedClip = clip.toObject() as Record<string, unknown> & { outputStorageKey?: string };
    const protocol = request.protocol;
    const host = request.get("host");
    const baseUrl = `${protocol}://${host}`;
    const updatedAtValue = serializedClip.updatedAt;
    const updatedAtTimestamp =
      updatedAtValue instanceof Date
        ? updatedAtValue.getTime()
        : typeof updatedAtValue === "string"
          ? Date.parse(updatedAtValue)
          : NaN;
    const renderVersionSuffix = Number.isFinite(updatedAtTimestamp) ? `?v=${updatedAtTimestamp}` : "";

    return {
      ...serializedClip,
      sourceVideoUrl: sourceVideoStorageKey ? `${baseUrl}/media/${sourceVideoStorageKey}` : undefined,
      outputUrl: serializedClip.outputStorageKey
        ? `${baseUrl}/media/${serializedClip.outputStorageKey}${renderVersionSuffix}`
        : undefined
    };
  };

  public listClips = async (request: Request, response: Response): Promise<void> => {
    const projectId = String(request.query.projectId);
    const [clips, sourceVideo] = await Promise.all([
      this.clipService.listByProjectId(projectId),
      this.sourceVideoService.getByProjectIdOrThrow(projectId)
    ]);

    sendSuccess(response, clips.map((clip) => this.serializeClip(request, clip, sourceVideo.storageKey)));
  };

  public reviewClip = async (request: Request, response: Response): Promise<void> => {
    const clip = await this.clipService.reviewClip(String(request.params.clipId), request.body.reviewStatus);

    if (request.body.reviewStatus === "approved" && clip) {
      await this.renderService.queueRender(clip.id, `${clip.projectId}`);
    }

    const sourceVideo = clip ? await this.sourceVideoService.getByProjectIdOrThrow(`${clip.projectId}`) : undefined;
    sendSuccess(response, this.serializeClip(request, clip, sourceVideo?.storageKey));
  };
}
