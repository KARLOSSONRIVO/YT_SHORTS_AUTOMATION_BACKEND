import { QUEUE_NAMES } from "../../../infrastructure/queue/queue.names";
import {
  DEFAULT_PROJECT_SUBTITLE_PREFERENCES,
  type ProjectSubtitlePreferences
} from "../../models/project.model";
import { PythonWorkerClient } from "../../../infrastructure/pythonWorker/python-worker.client";
import { ClipService } from "../clip/clip.service";
import { JobService } from "../job/job.service";
import { ProjectService } from "../project/project.service";
import { QueueService } from "../queue/queue.service";
import { SourceVideoService } from "../sourceVideo/source-video.service";
import { StorageService } from "../storage/storage.service";
import { TranscriptService } from "../transcript/transcript.service";

const WORD_LEAD_IN_SECONDS = 0.35;

export class RenderService {
  constructor(
    private readonly pythonWorkerClient: PythonWorkerClient,
    private readonly storageService: StorageService,
    private readonly sourceVideoService: SourceVideoService,
    private readonly clipService: ClipService,
    private readonly transcriptService: TranscriptService,
    private readonly projectService: ProjectService,
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

  private buildTranscriptPayload(transcript: Awaited<ReturnType<TranscriptService["getByProjectIdOrThrow"]>>) {
    const transcriptDurationSeconds =
      transcript.segments[transcript.segments.length - 1]?.endTimeSeconds ?? 0;

    return {
      language: transcript.language,
      duration: transcriptDurationSeconds,
      full_text: transcript.rawText,
      segments: transcript.segments.map((segment) => ({
        start: segment.startTimeSeconds,
        end: segment.endTimeSeconds,
        text: segment.text,
        words: segment.words.map((word) => ({
          start: word.startTimeSeconds,
          end: word.endTimeSeconds,
          word: word.word,
          probability: word.probability
        }))
      }))
    };
  }

  private buildSubtitlePreferences(
    projectSubtitlePreferences?: Partial<ProjectSubtitlePreferences>
  ): ProjectSubtitlePreferences {
    return {
      ...DEFAULT_PROJECT_SUBTITLE_PREFERENCES,
      ...(projectSubtitlePreferences ?? {})
    };
  }

  public async renderClip(projectId: string, clipId: string) {
    const [clip, sourceVideo, transcript, project] = await Promise.all([
      this.clipService.getClipOrThrow(clipId),
      this.sourceVideoService.getByProjectIdOrThrow(projectId),
      this.transcriptService.getByProjectIdOrThrow(projectId),
      this.projectService.getProjectOrThrow(projectId)
    ]);

    const sourcePath = this.storageService.resolveStoragePath(sourceVideo.storageKey);
    const subtitlePreferences = this.buildSubtitlePreferences(project.subtitlePreferences);
    const pythonRenderResult = await this.pythonWorkerClient.requestRenderedClipUpload({
      jobId: clipId,
      projectId,
      projectTitle: project.title,
      filePath: sourcePath,
      fileName: sourceVideo.originalFileName,
      mimeType: sourceVideo.mimeType,
      clipStart: Math.max(clip.startTimeSeconds - WORD_LEAD_IN_SECONDS, 0),
      clipEnd: clip.endTimeSeconds,
      titleHint: clip.title,
      score: clip.score,
      transcriptJson: JSON.stringify(this.buildTranscriptPayload(transcript)),
      fontFamily: subtitlePreferences.fontFamily,
      fontSize: subtitlePreferences.fontSize,
      fillColor: subtitlePreferences.fillColor,
      strokeColor: subtitlePreferences.strokeColor,
      highlightColor: subtitlePreferences.highlightColor,
      position: subtitlePreferences.position,
      maxCharsPerLine: subtitlePreferences.maxCharsPerLine,
      maxLines: subtitlePreferences.maxLines
    });

    const renderedVideoBuffer = await this.pythonWorkerClient.downloadBinary(pythonRenderResult.video_url);
    const storedRender = await this.storageService.saveRenderedClip(projectId, clipId, renderedVideoBuffer);

    await this.clipService.markRendered(clipId, storedRender.storageKey);

    const projectClips = await this.clipService.listByProjectId(projectId);
    const allRenderableClipsReady = projectClips.every(
      (projectClip) =>
        projectClip.reviewStatus === "rejected" ||
        projectClip.renderStatus === "rendered" ||
        projectClip.renderStatus === "failed"
    );

    if (allRenderableClipsReady) {
      await this.projectService.updateWorkflow(projectId, "review", "review");
    }

    return {
      clipId,
      outputStorageKey: storedRender.storageKey
    };
  }

  public async deleteRenderedClipAssets(outputStorageKey?: string, subtitleStorageKey?: string) {
    await Promise.all([
      outputStorageKey ? this.storageService.delete(outputStorageKey) : Promise.resolve(),
      subtitleStorageKey ? this.storageService.delete(subtitleStorageKey) : Promise.resolve()
    ]);
  }
}
