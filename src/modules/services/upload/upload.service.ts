import { AppError } from "../../../common/errors/app-error";
import { QUEUE_NAMES } from "../../../infrastructure/queue/queue.names";
import type { YouTubeSourceDownloader } from "../../../infrastructure/youtube/youtube-source-downloader";
import { StorageService } from "../storage/storage.service";
import { ProjectService } from "../project/project.service";
import { SourceVideoService } from "../sourceVideo/source-video.service";
import { QueueService } from "../queue/queue.service";
import { JobService } from "../job/job.service";
import type { ProjectSubtitlePreferences } from "../../models/project.model";
import { isYouTubeSourceUrl } from "../../validators/upload.validator";

export interface CreateUploadWorkflowInput {
  userId: string;
  title: string;
  description?: string;
  hashtags?: string;
  targetClipCount?: number;
  file: Express.Multer.File;
  fontFamily?: string;
  fontSize?: number;
  fillColor?: string;
  strokeColor?: string;
  highlightColor?: string;
  position?: "bottom_center" | "top_center" | "middle_center";
  maxCharsPerLine?: number;
  maxLines?: number;
}

export interface CreateYouTubeSourceWorkflowInput {
  userId: string;
  sourceUrl: string;
  title: string;
  description?: string;
  hashtags?: string;
  targetClipCount?: number;
  language?: string;
  subtitlePreferences?: Partial<ProjectSubtitlePreferences>;
}

export class UploadService {
  constructor(
    private readonly storageService: StorageService,
    private readonly projectService: ProjectService,
    private readonly sourceVideoService: SourceVideoService,
    private readonly queueService: QueueService,
    private readonly jobService: JobService,
    private readonly youtubeSourceDownloader: YouTubeSourceDownloader
  ) {}

  public async createUploadWorkflow(input: CreateUploadWorkflowInput) {
    const storedSourceVideo = await this.storageService.storeSourceVideo(input.file);
    const project = await this.projectService.createProject({
      userId: input.userId,
      title: input.title,
      description: input.description,
      hashtags: input.hashtags,
      targetClipCount: input.targetClipCount,
      subtitlePreferences: {
        fontFamily: input.fontFamily,
        fontSize: input.fontSize,
        fillColor: input.fillColor,
        strokeColor: input.strokeColor,
        highlightColor: input.highlightColor,
        position: input.position,
        maxCharsPerLine: input.maxCharsPerLine,
        maxLines: input.maxLines
      }
    });

    const sourceVideo = await this.sourceVideoService.createSourceVideo({
      projectId: project.id,
      originalFileName: input.file.originalname,
      mimeType: input.file.mimetype,
      storageKey: storedSourceVideo.storageKey,
      sizeBytes: input.file.size
    });

    const persistedJob = await this.jobService.createQueuedJob({
      projectId: project.id,
      queueName: QUEUE_NAMES.INGEST,
      type: "project.ingest",
      payload: {
        projectId: project.id,
        sourceVideoId: sourceVideo.id,
        storageKey: storedSourceVideo.storageKey
      }
    });

    const enqueuedJob = await this.queueService.addIngestJob({
      jobId: persistedJob.id,
      projectId: project.id,
      sourceVideoId: sourceVideo.id,
      storageKey: storedSourceVideo.storageKey
    });

    await this.jobService.updateJob(persistedJob.id, { externalJobId: `${enqueuedJob.id}` });

    return {
      project,
      sourceVideo,
      job: {
        id: persistedJob.id,
        queueName: persistedJob.queueName,
        externalJobId: `${enqueuedJob.id}`,
        status: persistedJob.status
      }
    };
  }

  public async createYouTubeSourceWorkflow(input: CreateYouTubeSourceWorkflowInput) {
    if (!isYouTubeSourceUrl(input.sourceUrl)) {
      throw new AppError("Use a YouTube video link.", 400, "INVALID_YOUTUBE_SOURCE_URL");
    }

    const downloadedSource = await this.youtubeSourceDownloader.download(input.sourceUrl);

    try {
      const storedSourceVideo = await this.storageService.storeSourceVideoFile({
        path: downloadedSource.filePath,
        originalname: downloadedSource.originalFileName,
        mimetype: downloadedSource.mimeType
      });
      const project = await this.projectService.createProject({
        userId: input.userId,
        title: input.title,
        description: input.description,
        hashtags: input.hashtags,
        targetClipCount: input.targetClipCount,
        subtitlePreferences: input.subtitlePreferences
      });

      const sourceVideo = await this.sourceVideoService.createSourceVideo({
        projectId: project.id,
        originalFileName: downloadedSource.originalFileName,
        mimeType: downloadedSource.mimeType,
        storageKey: storedSourceVideo.storageKey,
        sizeBytes: downloadedSource.sizeBytes,
        sourceUrl: input.sourceUrl
      });

      const persistedJob = await this.jobService.createQueuedJob({
        projectId: project.id,
        queueName: QUEUE_NAMES.INGEST,
        type: "project.ingest",
        payload: {
          projectId: project.id,
          sourceVideoId: sourceVideo.id,
          storageKey: storedSourceVideo.storageKey,
          languageHint: input.language
        }
      });

      const enqueuedJob = await this.queueService.addIngestJob({
        jobId: persistedJob.id,
        projectId: project.id,
        sourceVideoId: sourceVideo.id,
        storageKey: storedSourceVideo.storageKey,
        languageHint: input.language
      });

      await this.jobService.updateJob(persistedJob.id, { externalJobId: `${enqueuedJob.id}` });

      return {
        project,
        sourceVideo,
        job: {
          id: persistedJob.id,
          queueName: persistedJob.queueName,
          externalJobId: `${enqueuedJob.id}`,
          status: persistedJob.status
        }
      };
    } finally {
      await this.youtubeSourceDownloader.cleanup(downloadedSource);
    }
  }
}
