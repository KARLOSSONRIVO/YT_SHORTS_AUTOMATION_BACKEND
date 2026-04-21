import { AppError } from "../../../common/errors/app-error";
import { logger } from "../../../config/logger";
import {
  type PythonAnalysisResponse,
  type PythonMediaMetadata,
  type PythonWorkerClient
} from "../../../infrastructure/pythonWorker/python-worker.client";
import { QUEUE_NAMES } from "../../../infrastructure/queue/queue.names";
import { ClipService } from "../clip/clip.service";
import { JobService } from "../job/job.service";
import { ProjectService } from "../project/project.service";
import { PublishService } from "../publish/publish.service";
import { QueueService } from "../queue/queue.service";
import { RenderService } from "../render/render.service";
import { SourceVideoService } from "../sourceVideo/source-video.service";
import { StorageService } from "../storage/storage.service";
import { SubtitleService } from "../subtitle/subtitle.service";
import { TranscriptService } from "../transcript/transcript.service";

interface IngestPayload {
  jobId: string;
  projectId: string;
  sourceVideoId: string;
  storageKey: string;
}

interface TranscriptionPayload extends IngestPayload {
  languageHint?: string;
}

interface AnalysisPayload extends IngestPayload {
  languageHint?: string;
}

interface RenderPayload {
  jobId: string;
  projectId: string;
  clipId: string;
}

interface PublishPayload {
  jobId: string;
  clipId: string;
  channelId: string;
  title: string;
  description: string;
  privacyStatus: "private" | "public" | "unlisted";
}

interface PythonSubtitleSegment {
  start: number;
  end: number;
  text: string;
}

const srtTimestamp = (seconds: number): string => {
  const totalMilliseconds = Math.max(Math.round(seconds * 1000), 0);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(
    2,
    "0"
  )},${String(milliseconds).padStart(3, "0")}`;
};

const buildClipSubtitleSrt = (
  subtitles: PythonSubtitleSegment[],
  clipStart: number,
  clipEnd: number
): string => {
  const relevantSegments = subtitles
    .filter((segment) => segment.end > clipStart && segment.start < clipEnd)
    .map((segment) => ({
      start: Math.max(segment.start - clipStart, 0),
      end: Math.max(Math.min(segment.end, clipEnd) - clipStart, 0.1),
      text: segment.text.trim()
    }))
    .filter((segment) => segment.text.length > 0);

  return relevantSegments
    .map(
      (segment, index) =>
        `${index + 1}\n${srtTimestamp(segment.start)} --> ${srtTimestamp(segment.end)}\n${segment.text}`
    )
    .join("\n\n");
};

const extractVideoDimensions = (media: PythonMediaMetadata) => {
  const videoStream = media.streams.find((stream) => stream.codec_type === "video");

  return {
    durationSeconds: Math.round(media.duration_seconds ?? 0),
    width: videoStream?.width,
    height: videoStream?.height
  };
};

export class WorkflowOrchestratorService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly sourceVideoService: SourceVideoService,
    private readonly transcriptService: TranscriptService,
    private readonly clipService: ClipService,
    private readonly subtitleService: SubtitleService,
    private readonly jobService: JobService,
    private readonly queueService: QueueService,
    private readonly storageService: StorageService,
    private readonly pythonWorkerClient: PythonWorkerClient,
    private readonly renderService: RenderService,
    private readonly publishService: PublishService
  ) {}

  private async markJobActive(jobId: string) {
    await this.jobService.updateJob(jobId, {
      status: "active",
      startedAt: new Date(),
      completedAt: undefined,
      errorMessage: undefined
    });
  }

  private async markJobCompleted(jobId: string, result?: Record<string, unknown>) {
    await this.jobService.updateJob(jobId, {
      status: "completed",
      completedAt: new Date(),
      result
    });
  }

  private async markJobFailed(jobId: string, error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown worker error.";
    await this.jobService.updateJob(jobId, {
      status: "failed",
      completedAt: new Date(),
      errorMessage: message
    });
  }

  private async enqueueNextJob(input: {
    projectId: string;
    clipId?: string;
    queueName: (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
    type: string;
    payload: Record<string, unknown>;
  }) {
    const persistedJob = await this.jobService.createQueuedJob(input);

    let enqueuedJob: { id?: string | number } | undefined;

    switch (input.queueName) {
      case QUEUE_NAMES.TRANSCRIPTION:
        enqueuedJob = await this.queueService.addTranscriptionJob({
          jobId: persistedJob.id,
          ...input.payload
        });
        break;
      case QUEUE_NAMES.ANALYSIS:
        enqueuedJob = await this.queueService.addAnalysisJob({
          jobId: persistedJob.id,
          ...input.payload
        });
        break;
      case QUEUE_NAMES.RENDER:
        enqueuedJob = await this.queueService.addRenderJob({
          jobId: persistedJob.id,
          ...input.payload
        });
        break;
      case QUEUE_NAMES.UPLOAD:
        enqueuedJob = await this.queueService.addUploadJob({
          jobId: persistedJob.id,
          ...input.payload
        });
        break;
      default:
        throw new AppError(`Unsupported next queue ${input.queueName}.`, 500, "QUEUE_NOT_SUPPORTED");
    }

    await this.jobService.updateJob(persistedJob.id, { externalJobId: `${enqueuedJob.id}` });
    return persistedJob;
  }

  public async processIngest(payload: IngestPayload) {
    try {
      await this.markJobActive(payload.jobId);
      await this.projectService.updateWorkflow(payload.projectId, "ingest", "processing");
      await this.sourceVideoService.updateSourceVideo(payload.sourceVideoId, { status: "processing" });

      const transcriptionJob = await this.enqueueNextJob({
        projectId: payload.projectId,
        queueName: QUEUE_NAMES.TRANSCRIPTION,
        type: "project.transcription",
        payload: { ...payload }
      });

      await this.projectService.updateWorkflow(payload.projectId, "transcription", "processing");
      await this.markJobCompleted(payload.jobId, {
        nextJobId: `${transcriptionJob.id}`,
        nextQueue: QUEUE_NAMES.TRANSCRIPTION
      });
    } catch (error) {
      await this.sourceVideoService.updateSourceVideo(payload.sourceVideoId, { status: "failed" });
      await this.projectService.updateWorkflow(payload.projectId, "ingest", "failed");
      await this.markJobFailed(payload.jobId, error);
      throw error;
    }
  }

  public async processTranscription(payload: TranscriptionPayload) {
    try {
      await this.markJobActive(payload.jobId);
      await this.projectService.updateWorkflow(payload.projectId, "transcription", "processing");

      const sourceVideo = await this.sourceVideoService.getByProjectIdOrThrow(payload.projectId);
      const filePath = this.storageService.resolveStoragePath(sourceVideo.storageKey);
      const response = await this.pythonWorkerClient.requestTranscriptionUpload({
        jobId: payload.jobId,
        filePath,
        fileName: sourceVideo.originalFileName,
        mimeType: sourceVideo.mimeType,
        language: payload.languageHint
      });

      const transcript = await this.transcriptService.storeTranscript({
        projectId: payload.projectId,
        sourceVideoId: sourceVideo.id,
        language: response.transcript.language,
        rawText: response.transcript.full_text,
        segments: response.transcript.segments.map((segment) => ({
          startTimeSeconds: segment.start,
          endTimeSeconds: segment.end,
          text: segment.text,
          words: (segment.words ?? []).map((word) => ({
            startTimeSeconds: word.start,
            endTimeSeconds: word.end,
            word: word.word,
            probability: word.probability
          }))
        }))
      });

      const dimensions = extractVideoDimensions(response.media);
      await this.sourceVideoService.updateSourceVideo(sourceVideo.id, {
        status: "processing",
        ...dimensions
      });

      const analysisJob = await this.enqueueNextJob({
        projectId: payload.projectId,
        queueName: QUEUE_NAMES.ANALYSIS,
        type: "project.analysis",
        payload: { ...payload }
      });

      await this.projectService.updateWorkflow(payload.projectId, "analysis", "processing");
      await this.markJobCompleted(payload.jobId, {
        transcriptId: `${transcript.id}`,
        nextJobId: `${analysisJob.id}`,
        nextQueue: QUEUE_NAMES.ANALYSIS
      });
    } catch (error) {
      await this.sourceVideoService.updateSourceVideo(payload.sourceVideoId, { status: "failed" });
      await this.projectService.updateWorkflow(payload.projectId, "transcription", "failed");
      await this.markJobFailed(payload.jobId, error);
      throw error;
    }
  }

  private async persistAnalysisArtifacts(
    projectId: string,
    sourceVideoId: string,
    transcriptId: string,
    response: PythonAnalysisResponse
  ) {
    const createdClips = await this.clipService.createCandidateClips(
      response.clips.map((clip) => ({
        projectId,
        sourceVideoId,
        transcriptId,
        title: (clip.title_hint || clip.transcript_excerpt || "Generated clip").slice(0, 100),
        description: clip.transcript_excerpt.slice(0, 5000),
        startTimeSeconds: clip.start,
        endTimeSeconds: clip.end,
        score: clip.scores.total_score,
        analysisReason: clip.transcript_excerpt
      }))
    );

    await Promise.all(
      createdClips.map(async (clip, index) => {
        const originalClip = response.clips[index];
        if (!originalClip) {
          return;
        }

        const subtitleContent = buildClipSubtitleSrt(response.subtitles, originalClip.start, originalClip.end);

        if (subtitleContent.trim().length > 0) {
          await this.subtitleService.saveClipSubtitle(projectId, clip.id, subtitleContent);
        }
      })
    );

    return createdClips;
  }

  public async processAnalysis(payload: AnalysisPayload) {
    try {
      await this.markJobActive(payload.jobId);
      await this.projectService.updateWorkflow(payload.projectId, "analysis", "processing");

      const sourceVideo = await this.sourceVideoService.getByProjectIdOrThrow(payload.projectId);
      const transcript = await this.transcriptService.getByProjectIdOrThrow(payload.projectId);
      const project = await this.projectService.getProjectOrThrow(payload.projectId);
      const filePath = this.storageService.resolveStoragePath(sourceVideo.storageKey);
      const response = await this.pythonWorkerClient.requestClipAnalysisUpload({
        jobId: payload.jobId,
        filePath,
        fileName: sourceVideo.originalFileName,
        mimeType: sourceVideo.mimeType,
        language: payload.languageHint,
        topK: project.targetClipCount
      });

      const createdClips = await this.persistAnalysisArtifacts(
        payload.projectId,
        sourceVideo.id,
        transcript.id,
        response
      );

      const dimensions = extractVideoDimensions(response.media);
      await this.sourceVideoService.updateSourceVideo(sourceVideo.id, {
        status: "processed",
        ...dimensions
      });
      if (createdClips.length > 0) {
        await Promise.all(createdClips.map((clip) => this.renderService.queueRender(clip.id, payload.projectId)));
        await this.projectService.updateWorkflow(payload.projectId, "render", "processing");
      } else {
        await this.projectService.updateWorkflow(payload.projectId, "review", "review");
      }
      await this.markJobCompleted(payload.jobId, {
        clipCount: createdClips.length,
        warnings: response.warnings
      });
    } catch (error) {
      await this.sourceVideoService.updateSourceVideo(payload.sourceVideoId, { status: "failed" });
      await this.projectService.updateWorkflow(payload.projectId, "analysis", "failed");
      await this.markJobFailed(payload.jobId, error);
      throw error;
    }
  }

  public async processRender(payload: RenderPayload) {
    try {
      await this.markJobActive(payload.jobId);
      await this.clipService.markRendering(payload.clipId);
      const result = await this.renderService.renderClip(payload.projectId, payload.clipId);
      await this.markJobCompleted(payload.jobId, result);
    } catch (error) {
      await this.clipService.markRenderFailed(payload.clipId);
      const projectClips = await this.clipService.listByProjectId(payload.projectId);
      const allRenderableClipsReady = projectClips.every(
        (projectClip) =>
          projectClip.reviewStatus === "rejected" ||
          projectClip.renderStatus === "rendered" ||
          projectClip.renderStatus === "failed"
      );

      if (allRenderableClipsReady) {
        await this.projectService.updateWorkflow(payload.projectId, "review", "review");
      }
      await this.markJobFailed(payload.jobId, error);
      throw error;
    }
  }

  public async processPublish(payload: PublishPayload) {
    try {
      await this.markJobActive(payload.jobId);
      const result = await this.publishService.publishClipNow({
        clipId: payload.clipId,
        channelId: payload.channelId,
        title: payload.title,
        description: payload.description,
        privacyStatus: payload.privacyStatus
      });
      await this.markJobCompleted(payload.jobId, result);
    } catch (error) {
      await this.clipService.markPublishFailed(payload.clipId);
      await this.markJobFailed(payload.jobId, error);
      logger.error("Publish worker failed.", {
        clipId: payload.clipId,
        message: error instanceof Error ? error.message : "Unknown publish error"
      });
      throw error;
    }
  }
}
