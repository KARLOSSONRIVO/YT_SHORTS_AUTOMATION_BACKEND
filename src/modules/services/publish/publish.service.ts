import { AppError } from "../../../common/errors/app-error";
import { QUEUE_NAMES } from "../../../infrastructure/queue/queue.names";
import { UploadHistoryRepository } from "../../repositories/upload-history.repository";
import { ChannelService } from "../channel/channel.service";
import { ClipService } from "../clip/clip.service";
import { JobService } from "../job/job.service";
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
    private readonly queueService: QueueService
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
}
