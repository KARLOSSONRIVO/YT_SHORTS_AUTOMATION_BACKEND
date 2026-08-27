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
import { sanitizeUploadTitle } from "./upload-text";

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
    await this.projectService?.updateWorkflow(`${clip.projectId}`, "publish", "processing");

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
    const project = await this.projectService?.getProjectOrThrow(`${clip.projectId}`);
    const normalizedTitle = this.normalizeUploadTitle(input.title, clip.title || project?.title || "Short Clip");

    if (!clip.outputStorageKey) {
      throw new AppError("Clip output is missing and cannot be uploaded.", 409, "CLIP_OUTPUT_MISSING");
    }

    const clipVideoPath = this.storageService.resolveStoragePath(clip.outputStorageKey);

    const uploadedVideo = await this.youTubeService.uploadShort({
      tokens: {
        access_token: channel.accessToken,
        refresh_token: channel.refreshToken,
        expiry_date: channel.tokenExpiryDate?.getTime()
      },
      title: normalizedTitle,
      description: input.description,
      privacyStatus: input.privacyStatus,
      videoPath: clipVideoPath
    });

    const localArchive = project
      ? await this.storageService.archivePublishedVideo({
          projectTitle: project.title,
          category: "clips",
          fileLabel: `${clip.title}_${clip.id}`,
          publishFolderName: this.buildPublishFolderName({
            primaryId: `${clip.id}`,
            youtubeVideoId: uploadedVideo.id ?? undefined,
            publishedAt: new Date()
          }),
          sourceFilePath: clipVideoPath,
          metadata: {
            kind: "clip_publish",
            projectId: `${clip.projectId}`,
            projectTitle: project.title,
            clipId: `${clip.id}`,
            clipTitle: clip.title,
            channelId: input.channelId,
            channelTitle: channel.title,
            youtubeVideoId: uploadedVideo.id ?? undefined,
            youtubeVideoUrl: uploadedVideo.id ? `https://www.youtube.com/watch?v=${uploadedVideo.id}` : undefined,
            title: normalizedTitle,
            description: input.description,
            privacyStatus: input.privacyStatus,
            publishedAt: new Date().toISOString()
          }
        })
      : undefined;

    const uploadHistory = await this.uploadHistoryRepository.create({
      clipId: clip.id as never,
      projectId: clip.projectId as never,
      channelId: channel.id as never,
      youtubeVideoId: uploadedVideo.id ?? undefined,
      localArchiveStorageKey: localArchive?.video.storageKey,
      localArchiveMetadataKey: localArchive?.metadata.storageKey,
      title: normalizedTitle,
      description: input.description,
      privacyStatus: input.privacyStatus,
      status: "uploaded",
      uploadedAt: new Date(),
      responseSnapshot: uploadedVideo as Record<string, unknown>
    });

    await this.clipService.markPublished(input.clipId);
    await this.syncUploadedVideoProjectWorkflow(`${clip.projectId}`);

    return {
      clipId: input.clipId,
      channelId: input.channelId,
      uploadHistoryId: uploadHistory.id,
      youtubeVideoId: uploadedVideo.id,
      videoUrl: uploadedVideo.id ? `https://www.youtube.com/watch?v=${uploadedVideo.id}` : undefined
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
    const normalizedTitle = this.normalizeUploadTitle(input.title, project.title || "Faceless Story");

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
        title: normalizedTitle,
        description: input.description,
        privacyStatus: input.privacyStatus,
        videoPath: tempVideoPath
      });

      const localArchive = await this.storageService.archivePublishedVideo({
        projectTitle: project.title,
        category: "faceless",
        fileLabel: `${input.title}_${project.id}`,
        publishFolderName: this.buildPublishFolderName({
          primaryId: `${project.id}`,
          youtubeVideoId: uploadedVideo.id ?? undefined,
          publishedAt: new Date()
        }),
        sourceFilePath: tempVideoPath,
        metadata: {
          kind: "faceless_publish",
          projectId: input.projectId,
          projectTitle: project.title,
          channelId: input.channelId,
          channelTitle: channel.title,
          youtubeVideoId: uploadedVideo.id ?? undefined,
          youtubeVideoUrl: uploadedVideo.id ? `https://www.youtube.com/watch?v=${uploadedVideo.id}` : undefined,
          title: normalizedTitle,
          description: input.description,
          privacyStatus: input.privacyStatus,
          publishedAt: new Date().toISOString()
        }
      });

      const uploadHistory = await this.uploadHistoryRepository.create({
        projectId: project.id as never,
        channelId: channel.id as never,
        youtubeVideoId: uploadedVideo.id ?? undefined,
        localArchiveStorageKey: localArchive.video.storageKey,
        localArchiveMetadataKey: localArchive.metadata.storageKey,
        title: normalizedTitle,
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

  private async syncUploadedVideoProjectWorkflow(projectId: string) {
    if (!this.projectService) {
      return;
    }

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

  public async backfillPublishedArchives() {
    const missingArchiveRecords = await this.uploadHistoryRepository.findMissingArchiveRecords();

    for (const record of missingArchiveRecords) {
      const source = await this.resolveArchiveSource(record);
      if (!source) {
        continue;
      }

      const recordId = record.id ?? `${record._id}`;
      const publishedAt = record.uploadedAt ?? new Date();
      const archive = await this.storageService.archivePublishedVideo({
        projectTitle: source.projectTitle,
        category: source.category,
        fileLabel: source.fileLabel,
        publishFolderName: this.buildPublishFolderName({
          primaryId: source.primaryId,
          youtubeVideoId: record.youtubeVideoId,
          publishedAt
        }),
        sourceFilePath: source.sourceFilePath,
        metadata: {
          kind: source.category === "clips" ? "clip_publish" : "faceless_publish",
          projectId: source.projectId,
          projectTitle: source.projectTitle,
          clipId: source.clipId,
          channelId: `${record.channelId}`,
          youtubeVideoId: record.youtubeVideoId,
          youtubeVideoUrl: record.youtubeVideoId ? `https://www.youtube.com/watch?v=${record.youtubeVideoId}` : undefined,
          title: record.title,
          description: record.description,
          privacyStatus: record.privacyStatus,
          publishedAt: publishedAt.toISOString()
        }
      });

      await this.uploadHistoryRepository.updateById(recordId, {
        localArchiveStorageKey: archive.video.storageKey,
        localArchiveMetadataKey: archive.metadata.storageKey
      });
    }
  }

  private buildPublishFolderName(input: {
    primaryId: string;
    youtubeVideoId?: string;
    publishedAt: Date;
  }) {
    const timestamp = input.publishedAt.toISOString().replace(/[:.]/g, "-");
    const suffix = input.youtubeVideoId ?? input.primaryId;
    return `${timestamp}_${suffix}`;
  }

  private normalizeUploadTitle(rawTitle: string, fallbackTitle: string) {
    return sanitizeUploadTitle(rawTitle, fallbackTitle);
  }

  private async resolveArchiveSource(record: {
    id?: string;
    _id?: { toString(): string };
    clipId?: { toString(): string } | string;
    projectId?: { toString(): string } | string;
  }) {
    const clipId = record.clipId ? `${record.clipId}` : undefined;
    if (clipId) {
      const clip = await this.clipService.getClipOrThrow(clipId).catch(() => null);
      if (!clip?.outputStorageKey) {
        return null;
      }

      const project = this.projectService ? await this.projectService.getProjectOrThrow(`${clip.projectId}`).catch(() => null) : null;
      if (!project) {
        return null;
      }

      return {
        category: "clips" as const,
        projectId: `${clip.projectId}`,
        projectTitle: project.title,
        clipId: `${clip.id}`,
        primaryId: `${clip.id}`,
        fileLabel: `${clip.title}_${clip.id}`,
        sourceFilePath: this.storageService.resolveStoragePath(clip.outputStorageKey)
      };
    }

    const projectId = record.projectId ? `${record.projectId}` : undefined;
    if (!projectId || !this.projectService || !this.facelessVideoRepository) {
      return null;
    }

    const [project, finalVideoAsset] = await Promise.all([
      this.projectService.getProjectOrThrow(projectId).catch(() => null),
      this.facelessVideoRepository.findLatestAssetByType(projectId, "final_video").catch(() => null)
    ]);

    if (!project || !finalVideoAsset?.absolutePath) {
      return null;
    }

    return {
      category: "faceless" as const,
      projectId,
      projectTitle: project.title,
      clipId: undefined,
      primaryId: projectId,
      fileLabel: `${project.title}_${projectId}`,
      sourceFilePath: finalVideoAsset.absolutePath
    };
  }
}
