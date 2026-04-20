import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError } from "../../../common/errors/app-error";
import { PythonWorkerClient } from "../../../infrastructure/pythonWorker/python-worker.client";
import { QUEUE_NAMES } from "../../../infrastructure/queue/queue.names";
import { UploadHistoryRepository } from "../../repositories/upload-history.repository";
import { FacelessVideoRepository } from "../../repositories/faceless-video.repository";
import { ChannelService } from "../channel/channel.service";
import { ClipService } from "../clip/clip.service";
import { JobService } from "../job/job.service";
import { ProjectService } from "../project/project.service";
import { QueueService } from "../queue/queue.service";
import { StorageService } from "../storage/storage.service";
import { YouTubeService } from "../youtube/youtube.service";

export class PublishService {
  constructor(
    private readonly clipService: ClipService,
    private readonly channelService: ChannelService,
    private readonly youTubeService: YouTubeService,
    private readonly storageService: StorageService,
    private readonly uploadHistoryRepository: UploadHistoryRepository,
    private readonly jobService: JobService,
    private readonly queueService: QueueService,
    private readonly projectService?: ProjectService,
    private readonly facelessVideoRepository?: FacelessVideoRepository,
    private readonly pythonWorkerClient?: PythonWorkerClient
  ) {}

  public async queueClipPublish(input: {
    clipId: string;
    channelId: string;
    title: string;
    description: string;
    privacyStatus: "private" | "public" | "unlisted";
  }) {
    const clip = await this.clipService.getClipOrThrow(input.clipId);

    if (clip.reviewStatus !== "approved") {
      throw new AppError("Only approved clips can be queued for publishing.", 409, "CLIP_NOT_APPROVED");
    }

    if (clip.renderStatus !== "rendered" || !clip.outputStorageKey) {
      throw new AppError("Clip must be rendered before publishing.", 409, "CLIP_NOT_RENDERED");
    }

    const persistedJob = await this.jobService.createQueuedJob({
      projectId: `${clip.projectId}`,
      clipId: input.clipId,
      queueName: QUEUE_NAMES.UPLOAD,
      type: "clip.publish",
      payload: input
    });

    const enqueuedJob = await this.queueService.addUploadJob({
      jobId: persistedJob.id,
      ...input
    });

    await this.jobService.updateJob(persistedJob.id, { externalJobId: `${enqueuedJob.id}` });
    await this.clipService.markPublishQueued(input.clipId);

    return {
      jobId: persistedJob.id,
      externalJobId: `${enqueuedJob.id}`,
      clipId: input.clipId,
      status: "queued"
    };
  }

  public async publishClipNow(input: {
    clipId: string;
    channelId: string;
    title: string;
    description: string;
    privacyStatus: "private" | "public" | "unlisted";
  }) {
    const clip = await this.clipService.getClipOrThrow(input.clipId);
    const channel = await this.channelService.getChannelOrThrow(input.channelId);

    if (!clip.outputStorageKey) {
      throw new AppError("Clip output is missing and cannot be uploaded.", 409, "CLIP_OUTPUT_MISSING");
    }

    const uploadedVideo = await this.youTubeService.uploadShort({
      tokens: {
        access_token: channel.accessToken,
        refresh_token: channel.refreshToken,
        expiry_date: channel.tokenExpiryDate?.getTime()
      },
      title: input.title,
      description: input.description,
      privacyStatus: input.privacyStatus,
      videoPath: this.storageService.resolveStoragePath(clip.outputStorageKey)
    });

    const uploadHistory = await this.uploadHistoryRepository.create({
      clipId: clip.id as never,
      channelId: channel.id as never,
      youtubeVideoId: uploadedVideo.id ?? undefined,
      title: input.title,
      description: input.description,
      privacyStatus: input.privacyStatus,
      status: "uploaded",
      uploadedAt: new Date(),
      responseSnapshot: uploadedVideo as Record<string, unknown>
    });

    await this.clipService.markPublished(input.clipId);

    return {
      clipId: input.clipId,
      channelId: input.channelId,
      uploadHistoryId: uploadHistory.id,
      youtubeVideoId: uploadedVideo.id
    };
  }

  public async publishFacelessProjectNow(input: {
    projectId: string;
    channelId: string;
    title: string;
    description: string;
    privacyStatus: "private" | "public" | "unlisted";
  }) {
    if (!this.projectService || !this.facelessVideoRepository) {
      throw new AppError("Faceless publishing is not configured.", 500, "FACELESS_PUBLISH_NOT_CONFIGURED");
    }

    const [project, channel, finalVideoAsset] = await Promise.all([
      this.projectService.getProjectOrThrow(input.projectId),
      this.channelService.getChannelOrThrow(input.channelId),
      this.facelessVideoRepository.findLatestAssetByType(input.projectId, "final_video")
    ]);

    if (project.projectType !== "faceless_story") {
      throw new AppError("Only faceless story projects can be published from this endpoint.", 409, "PROJECT_NOT_FACELESS");
    }

    if (!finalVideoAsset?.absolutePath) {
      throw new AppError("Final video is missing and cannot be uploaded.", 409, "FINAL_VIDEO_MISSING");
    }

    const tempVideoPath = await this.prepareFacelessVideoUploadSource(input.projectId, finalVideoAsset);

    try {
      const uploadedVideo = await this.youTubeService.uploadShort({
        tokens: {
          access_token: channel.accessToken,
          refresh_token: channel.refreshToken,
          expiry_date: channel.tokenExpiryDate?.getTime()
        },
        title: input.title,
        description: input.description,
        privacyStatus: input.privacyStatus,
        videoPath: tempVideoPath
      });

      const uploadHistory = await this.uploadHistoryRepository.create({
        projectId: project.id as never,
        channelId: channel.id as never,
        youtubeVideoId: uploadedVideo.id ?? undefined,
        title: input.title,
        description: input.description,
        privacyStatus: input.privacyStatus,
        status: "uploaded",
        uploadedAt: new Date(),
        responseSnapshot: uploadedVideo as Record<string, unknown>
      });

      await this.projectService.updateProject(input.projectId, {
        status: "published",
        workflowStage: "publish"
      });

      return {
        projectId: input.projectId,
        channelId: input.channelId,
        uploadHistoryId: uploadHistory.id,
        youtubeVideoId: uploadedVideo.id,
        videoUrl: uploadedVideo.id ? `https://www.youtube.com/watch?v=${uploadedVideo.id}` : undefined
      };
    } finally {
      if (tempVideoPath !== finalVideoAsset.absolutePath) {
        await fs.unlink(tempVideoPath).catch(() => undefined);
      }
    }
  }

  private async prepareFacelessVideoUploadSource(
    projectId: string,
    finalVideoAsset: { absolutePath?: string; url?: string }
  ): Promise<string> {
    if (this.pythonWorkerClient && finalVideoAsset.url) {
      const videoBuffer = await this.pythonWorkerClient.downloadBinary(finalVideoAsset.url);
      const tempVideoPath = path.join(os.tmpdir(), `faceless-publish-${projectId}-${Date.now()}.mp4`);
      await fs.writeFile(tempVideoPath, videoBuffer);
      return tempVideoPath;
    }

    if (finalVideoAsset.absolutePath) {
      return finalVideoAsset.absolutePath;
    }

    throw new AppError("Final video source could not be resolved for upload.", 409, "FINAL_VIDEO_SOURCE_MISSING");
  }
}
