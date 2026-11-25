import type { Request, Response } from "express";
import { AppError } from "../../../common/errors/app-error";
import { getAuthenticatedUser } from "../../../common/middlewares/require-auth.middleware";
import { sendSuccess } from "../../../common/utils/api-response";
import { ClipService } from "../../services/clip/clip.service";
import { ProjectService } from "../../services/project/project.service";
import { RenderService } from "../../services/render/render.service";
import { SourceVideoService } from "../../services/sourceVideo/source-video.service";
import { UploadHistoryRepository } from "../../repositories/upload-history.repository";
import type { reviewClipBodySchema } from "../../validators/clip.validator";
import type { z } from "zod";

export class ClipController {
  constructor(
    private readonly clipService: ClipService,
    private readonly renderService: RenderService,
    private readonly sourceVideoService: SourceVideoService,
    private readonly uploadHistoryRepository: UploadHistoryRepository,
    private readonly projectService: ProjectService
  ) {}

  private serializeClip = (
    request: Request,
    clip: { toObject(): Record<string, unknown> } | null,
    sourceVideoStorageKey?: string,
    publishInfo?: {
      youtubeVideoId?: string;
      youtubeVideoUrl?: string;
      localArchiveStorageKey?: string;
      localArchiveMetadataKey?: string;
    }
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
        : undefined,
      youtubeVideoId: publishInfo?.youtubeVideoId,
      youtubeVideoUrl: publishInfo?.youtubeVideoUrl,
      localArchiveStorageKey: publishInfo?.localArchiveStorageKey,
      localArchiveMetadataKey: publishInfo?.localArchiveMetadataKey
    };
  };

  public listClips = async (request: Request, response: Response): Promise<void> => {
    const projectId = String(request.query.projectId);
    await this.projectService.getOwnedProjectOrThrow(projectId, getAuthenticatedUser(request).id);
    const [clips, sourceVideo] = await Promise.all([
      this.clipService.listByProjectId(projectId),
      this.sourceVideoService.getByProjectIdOrThrow(projectId)
    ]);

    const publishInfoEntries = await Promise.all(
      clips.map(async (clip) => {
        const latestUpload = await this.uploadHistoryRepository.findLatestByClipId(clip.id);
        return [
          clip.id,
          latestUpload?.youtubeVideoId
            ? {
                youtubeVideoId: latestUpload.youtubeVideoId,
                youtubeVideoUrl: `https://www.youtube.com/watch?v=${latestUpload.youtubeVideoId}`,
                localArchiveStorageKey: latestUpload.localArchiveStorageKey,
                localArchiveMetadataKey: latestUpload.localArchiveMetadataKey
              }
            : latestUpload?.localArchiveStorageKey || latestUpload?.localArchiveMetadataKey
              ? {
                  localArchiveStorageKey: latestUpload.localArchiveStorageKey,
                  localArchiveMetadataKey: latestUpload.localArchiveMetadataKey
                }
              : undefined
        ] as const;
      })
    );

    const publishInfoByClipId = new Map(publishInfoEntries);

    sendSuccess(
      response,
      clips.map((clip) =>
        this.serializeClip(request, clip, sourceVideo.storageKey, publishInfoByClipId.get(clip.id))
      )
    );
  };

  public reviewClip = async (request: Request, response: Response): Promise<void> => {
    const clipId = String(request.params.clipId);
    const existing = await this.clipService.getClipOrThrow(clipId);
    const projectId = String(existing.projectId);
    await this.projectService.getOwnedProjectOrThrow(projectId, getAuthenticatedUser(request).id);
    const { reviewStatus, ...edits }: z.infer<typeof reviewClipBodySchema> = request.body;
    const { clipRange } = edits;
    const sourceVideo = await this.sourceVideoService.getByProjectIdOrThrow(projectId);

    if (clipRange) {
      const sourceDuration = await this.sourceVideoService.readDurationSeconds(sourceVideo.storageKey);
      if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
        throw new AppError("The source duration could not be verified.", 422, "SOURCE_DURATION_UNAVAILABLE");
      }
      const endTimeSeconds = Math.min(clipRange.endTimeSeconds, sourceDuration);
      if (clipRange.endTimeSeconds > sourceDuration + 0.001 || endTimeSeconds - clipRange.startTimeSeconds < 0.1 - 1e-9) {
        throw new AppError("Choose a range of at least 0.1 seconds within the source video.", 422, "INVALID_CLIP_RANGE");
      }
      clipRange.endTimeSeconds = endTimeSeconds;
    }

    let clip = await this.clipService.reviewClip(clipId, reviewStatus, edits);

    if (reviewStatus === "approved" && clip && !clip.outputStorageKey) {
      await this.renderService.queueRender(clip.id, `${clip.projectId}`);
    }

    if (reviewStatus === "rejected" && clip?.outputStorageKey) {
      await this.renderService.deleteRenderedClipAssets(clip.outputStorageKey, clip.subtitleStorageKey);
      clip = await this.clipService.clearRenderedOutput(clipId);
    }

    if (clip) {
      await this.syncUploadedVideoProjectWorkflow(`${clip.projectId}`);
    }

    const latestUpload = clip ? await this.uploadHistoryRepository.findLatestByClipId(clip.id) : undefined;

    sendSuccess(
      response,
      this.serializeClip(
        request,
        clip,
        sourceVideo?.storageKey,
        latestUpload?.youtubeVideoId
          ? {
              youtubeVideoId: latestUpload.youtubeVideoId,
              youtubeVideoUrl: `https://www.youtube.com/watch?v=${latestUpload.youtubeVideoId}`,
              localArchiveStorageKey: latestUpload.localArchiveStorageKey,
              localArchiveMetadataKey: latestUpload.localArchiveMetadataKey
            }
          : latestUpload?.localArchiveStorageKey || latestUpload?.localArchiveMetadataKey
            ? {
                localArchiveStorageKey: latestUpload.localArchiveStorageKey,
                localArchiveMetadataKey: latestUpload.localArchiveMetadataKey
              }
            : undefined
      )
    );
  };

  private async syncUploadedVideoProjectWorkflow(projectId: string) {
    const projectClips = await this.clipService.listByProjectId(projectId);
    const hasPendingReview = projectClips.some((clip) => clip.reviewStatus === "pending_review");
    const hasApprovedAwaitingRender = projectClips.some(
      (clip) =>
        clip.reviewStatus === "approved" &&
        clip.renderStatus !== "rendered" &&
        clip.renderStatus !== "failed"
    );
    const hasApprovedAwaitingPublish = projectClips.some(
      (clip) =>
        clip.reviewStatus === "approved" &&
        clip.renderStatus === "rendered" &&
        clip.publishStatus !== "published"
    );

    if (hasPendingReview) {
      await this.projectService.updateWorkflow(projectId, "review", "review");
      return;
    }

    if (hasApprovedAwaitingRender) {
      await this.projectService.updateWorkflow(projectId, "render", "processing");
      return;
    }

    if (!hasApprovedAwaitingPublish) {
      await this.projectService.updateWorkflow(projectId, "completed", "completed");
      return;
    }

    await this.projectService.updateWorkflow(projectId, "publish", "processing");
  }
}
