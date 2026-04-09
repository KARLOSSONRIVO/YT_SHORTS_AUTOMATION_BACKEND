import fs from "node:fs/promises";
import path from "node:path";
import { FfmpegClient } from "../../../infrastructure/ffmpeg/ffmpeg.client";
import { QUEUE_NAMES } from "../../../infrastructure/queue/queue.names";
import { ClipService } from "../clip/clip.service";
import { JobService } from "../job/job.service";
import { QueueService } from "../queue/queue.service";
import { StorageService } from "../storage/storage.service";
import { SourceVideoService } from "../sourceVideo/source-video.service";

export class RenderService {
  constructor(
    private readonly ffmpegClient: FfmpegClient,
    private readonly storageService: StorageService,
    private readonly sourceVideoService: SourceVideoService,
    private readonly clipService: ClipService,
    private readonly jobService: JobService,
    private readonly queueService: QueueService
  ) {}

  public async queueRender(clipId: string, projectId: string) {
    const persistedJob = await this.jobService.createQueuedJob({
      projectId,
      clipId,
      queueName: QUEUE_NAMES.RENDER,
      type: "clip.render",
      payload: { projectId, clipId }
    });

    const enqueuedJob = await this.queueService.addRenderJob({
      jobId: persistedJob.id,
      projectId,
      clipId
    });

    await this.jobService.updateJob(persistedJob.id, { externalJobId: `${enqueuedJob.id}` });
    return persistedJob;
  }

  public async renderClip(projectId: string, clipId: string) {
    const clip = await this.clipService.getClipOrThrow(clipId);
    const sourceVideo = await this.sourceVideoService.getByProjectIdOrThrow(projectId);

    const sourcePath = this.storageService.resolveStoragePath(sourceVideo.storageKey);
    const renderStorageKey = this.storageService.buildRenderStorageKey(projectId, clipId);
    const outputPath = this.storageService.resolveStoragePath(renderStorageKey);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await this.ffmpegClient.renderClip({
      inputPath: sourcePath,
      outputPath,
      startTimeSeconds: clip.startTimeSeconds,
      durationSeconds: clip.durationSeconds,
      subtitlePath: clip.subtitleStorageKey
        ? this.storageService.resolveStoragePath(clip.subtitleStorageKey)
        : undefined
    });

    await this.clipService.markRendered(clipId, renderStorageKey);

    return {
      clipId,
      outputStorageKey: renderStorageKey
    };
  }
}
