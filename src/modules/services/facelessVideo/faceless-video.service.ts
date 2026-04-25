import { AppError } from "../../../common/errors/app-error";
import { QUEUE_NAMES } from "../../../infrastructure/queue/queue.names";
import {
  type PythonFacelessScene,
  type PythonFacelessVoice,
  type PythonWorkerClient
} from "../../../infrastructure/pythonWorker/python-worker.client";
import { type ProjectDocument } from "../../models/project.model";
import { type ProjectSubtitlePreferences } from "../../models/project.model";
import { type StoryAssetDocument, type StoryAssetType } from "../../models/story-asset.model";
import { FacelessVideoRepository } from "../../repositories/faceless-video.repository";
import { UploadHistoryRepository } from "../../repositories/upload-history.repository";
import { JobService } from "../job/job.service";
import { ProjectService } from "../project/project.service";
import { QueueService } from "../queue/queue.service";
import { RedditTrendingService } from "../redditStory/reddit-trending.service";

export type FacelessStage = "script" | "audio" | "subtitles" | "scenes" | "render";

export interface CreateFacelessProjectInput {
  userId: string;
  title?: string;
  description?: string;
  topic: string;
  platforms?: Array<"youtube" | "tiktok">;
  targetDurationSeconds?: number;
  stylePreset?: string;
  voice?: string;
  tone?: string;
  audience?: string;
}

export interface CreateTrendingRedditProjectInput {
  userId: string;
  maxDurationSeconds?: number;
  voice?: string;
  subtitlePreferences?: Partial<ProjectSubtitlePreferences>;
}

interface StoryStagePayload {
  jobId: string;
  projectId: string;
  stage: FacelessStage;
  autoRun?: boolean;
}

const STAGE_WORKFLOW: Record<FacelessStage, { workflowStage: string; status: string }> = {
  script: { workflowStage: "script", status: "writing_script" },
  audio: { workflowStage: "audio", status: "generating_audio" },
  subtitles: { workflowStage: "subtitles", status: "generating_subtitles" },
  scenes: { workflowStage: "scenes", status: "generating_images" },
  render: { workflowStage: "render", status: "rendering" }
};

const NEXT_STAGE: Partial<Record<FacelessStage, FacelessStage>> = {
  script: "audio",
  audio: "subtitles",
  subtitles: "scenes",
  scenes: "render"
};

export class FacelessVideoService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly jobService: JobService,
    private readonly queueService: QueueService,
    private readonly pythonWorkerClient: PythonWorkerClient,
    private readonly facelessVideoRepository: FacelessVideoRepository,
    private readonly redditTrendingService: RedditTrendingService,
    private readonly uploadHistoryRepository?: UploadHistoryRepository
  ) {}

  public createProject(input: CreateFacelessProjectInput) {
    return this.projectService.createFacelessStoryProject(input);
  }

  public async createTrendingRedditProject(input: CreateTrendingRedditProjectInput) {
    const redditPost = await this.redditTrendingService.pickTrendingPost({});

    return this.projectService.createRedditStoryProject({
      userId: input.userId,
      subreddit: redditPost.subreddit,
      maxDurationSeconds: input.maxDurationSeconds,
      voice: input.voice,
      subtitlePreferences: input.subtitlePreferences,
      redditSource: {
        postId: redditPost.postId,
        permalink: redditPost.permalink,
        title: redditPost.title,
        body: redditPost.body,
        subreddit: redditPost.subreddit,
        author: redditPost.author,
        score: redditPost.score,
        fetchedAt: redditPost.fetchedAt
      }
    });
  }

  public async enqueueStage(projectId: string, stage: FacelessStage, options: { autoRun?: boolean } = {}) {
    await this.projectService.getProjectOrThrow(projectId);
    await this.projectService.updateProject(projectId, {
      status: "queued",
      workflowStage: STAGE_WORKFLOW[stage].workflowStage
    });

    if (stage === "render") {
      await this.facelessVideoRepository.upsertRender(projectId, { status: "queued" });
    }

    const persistedJob = await this.jobService.createQueuedJob({
      projectId,
      queueName: QUEUE_NAMES.STORY,
      type: `faceless.${stage}`,
      payload: {
        projectId,
        stage,
        autoRun: options.autoRun ?? false
      }
    });

    const enqueuedJob = await this.queueService.addStoryJob({
      jobId: persistedJob.id,
      projectId,
      stage,
      autoRun: options.autoRun ?? false
    });

    await this.jobService.updateJob(persistedJob.id, { externalJobId: `${enqueuedJob.id}` });
    return persistedJob;
  }

  public startAutomation(projectId: string) {
    return this.enqueueStage(projectId, "script", { autoRun: true });
  }

  public async getProjectStatus(projectId: string) {
    const [project, script, assets, render, jobs] = await Promise.all([
      this.projectService.getProjectOrThrow(projectId),
      this.facelessVideoRepository.findScript(projectId),
      this.facelessVideoRepository.findAssets(projectId),
      this.facelessVideoRepository.findRender(projectId),
      this.jobService.listByProjectId(projectId)
    ]);

    return {
      project,
      script,
      render,
      latestJob: jobs[0] ?? null,
      counts: {
        scenes: script?.scenes.length ?? 0,
        assets: assets.length
      }
    };
  }

  public listAssets(projectId: string) {
    return this.facelessVideoRepository.findAssets(projectId);
  }

  public listVoices(): Promise<PythonFacelessVoice[]> {
    return this.pythonWorkerClient.requestFacelessVoices();
  }

  public async getVoicePreview(voice: string) {
    const preview = await this.pythonWorkerClient.requestFacelessVoicePreview({ voice });
    const audio = await this.pythonWorkerClient.downloadBinary(preview.audio_url);

    return {
      voice: preview.voice,
      buffer: audio,
      mimeType: "audio/wav",
      fileName: `${preview.voice}.wav`,
      sampleText: preview.sample_text
    };
  }

  public async getLatestPublishInfo(projectId: string) {
    if (!this.uploadHistoryRepository) {
      return null;
    }

    const latestUpload = await this.uploadHistoryRepository.findLatestByProjectId(projectId);
    if (!latestUpload || latestUpload.status !== "uploaded" || !latestUpload.youtubeVideoId) {
      return null;
    }

    return {
      youtubeVideoId: latestUpload.youtubeVideoId,
      videoUrl: `https://www.youtube.com/watch?v=${latestUpload.youtubeVideoId}`,
      uploadedAt: latestUpload.uploadedAt?.toISOString(),
      title: latestUpload.title,
      privacyStatus: latestUpload.privacyStatus
    };
  }

  public async processStage(payload: StoryStagePayload) {
    try {
      await this.markJobActive(payload.jobId);
      const state = STAGE_WORKFLOW[payload.stage];
      await this.projectService.updateWorkflow(payload.projectId, state.workflowStage, state.status);

      let result: unknown;
      switch (payload.stage) {
        case "script":
          result = await this.processScript(payload);
          break;
        case "audio":
          result = await this.processAudio(payload);
          break;
        case "subtitles":
          result = await this.processSubtitles(payload);
          break;
        case "scenes":
          result = await this.processScenes(payload);
          break;
        case "render":
          result = await this.processRender(payload);
          break;
        default:
          throw new AppError("Unsupported faceless video stage.", 400, "UNSUPPORTED_FACELESS_STAGE");
      }

      if (payload.autoRun) {
        const project = await this.projectService.getProjectOrThrow(payload.projectId);
        const nextStage = this.getNextStage(project.facelessSource, payload.stage);
        if (nextStage) {
          const nextJob = await this.enqueueStage(payload.projectId, nextStage, { autoRun: true });
          return { result, nextJob };
        }
      }

      return result;
    } catch (error) {
      await this.projectService.updateProject(payload.projectId, { status: "failed" });
      if (payload.stage === "render") {
        await this.facelessVideoRepository.upsertRender(payload.projectId, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Unknown render error."
        });
      }
      await this.markJobFailed(payload.jobId, error);
      throw error;
    }
  }

  private async processScript(payload: StoryStagePayload) {
    const project = await this.projectService.getProjectOrThrow(payload.projectId);
    if (project.facelessSource === "reddit_trending" && project.redditSource) {
      const script = await this.buildRedditStoryScript(payload, project);
      await this.markJobCompleted(payload.jobId, { scriptId: script.id, sceneCount: script.scenes.length });
      return script;
    }

    if (!project.topic) {
      throw new AppError("A topic is required before generating a faceless script.", 409, "TOPIC_REQUIRED");
    }

    const response = await this.pythonWorkerClient.requestFacelessScript({
      jobId: payload.jobId,
      projectId: payload.projectId,
      projectTitle: project.title,
      topic: project.topic,
      targetDurationSeconds: project.targetDurationSeconds,
      stylePreset: project.stylePreset
    });

    const script = await this.facelessVideoRepository.upsertScript(payload.projectId, {
      title: response.title,
      hook: response.hook,
      narration: response.narration,
      captionText: response.caption_text,
      imagePrompts: response.image_prompts,
      scenes: response.scenes.map((scene) => ({
        sceneIndex: scene.scene_index,
        narration: scene.narration,
        imagePrompt: scene.image_prompt,
        durationSeconds: scene.duration_seconds,
        captionText: scene.caption_text
      }))
    });

    await this.projectService.updateProject(payload.projectId, {
      title: response.title,
      workflowStage: "script",
      status: "writing_script"
    });
    await this.markJobCompleted(payload.jobId, { scriptId: script.id, sceneCount: script.scenes.length });
    return script;
  }

  private async processAudio(payload: StoryStagePayload) {
    const [project, script] = await Promise.all([
      this.projectService.getProjectOrThrow(payload.projectId),
      this.getScriptOrThrow(payload.projectId)
    ]);

    const response = await this.pythonWorkerClient.requestFacelessAudio({
      jobId: payload.jobId,
      projectId: payload.projectId,
      projectTitle: project.title,
      outputBucket: this.outputBucketForProject(project),
      narration: script.narration,
      voice: project.voice,
      speakingRate:
        project.facelessSource === "reddit_trending"
          ? this.redditSpeakingRate(script.narration)
          : undefined
    });

    const assets = await this.facelessVideoRepository.replaceAssets(payload.projectId, ["narration_audio"], [
      {
        assetType: "narration_audio",
        absolutePath: response.audio_path,
        url: response.audio_url,
        mimeType: "audio/wav",
        metadata: {
          durationSeconds: response.duration_seconds,
          voice: response.voice
        }
      }
    ]);

    await this.markJobCompleted(payload.jobId, { assetIds: assets.map((asset) => asset.id) });
    return assets[0];
  }

  private async processSubtitles(payload: StoryStagePayload) {
    const [project, script, audioAsset] = await Promise.all([
      this.projectService.getProjectOrThrow(payload.projectId),
      this.getScriptOrThrow(payload.projectId),
      this.facelessVideoRepository.findLatestAssetByType(payload.projectId, "narration_audio")
    ]);

    const response = await this.pythonWorkerClient.requestFacelessSubtitles({
      jobId: payload.jobId,
      projectId: payload.projectId,
      projectTitle: project.title,
      outputBucket: this.outputBucketForProject(project),
      audioPath: audioAsset?.absolutePath,
      scenes: this.toPythonScenes(script.scenes),
      subtitlePreferences: project.subtitlePreferences
    });

    const assets = await this.facelessVideoRepository.replaceAssets(
      payload.projectId,
      ["subtitle_srt", "subtitle_ass", "subtitle_json"],
      [
        {
          assetType: "subtitle_srt",
          absolutePath: response.srt_path,
          url: response.srt_url,
          mimeType: "application/x-subrip"
        },
        {
          assetType: "subtitle_ass",
          absolutePath: response.ass_path,
          url: response.ass_url,
          mimeType: "text/x-ssa"
        },
        {
          assetType: "subtitle_json",
          absolutePath: response.timestamp_json_path,
          url: response.timestamp_json_url,
          mimeType: "application/json",
          metadata: { subtitles: response.subtitles }
        }
      ]
    );

    await this.markJobCompleted(payload.jobId, { assetIds: assets.map((asset) => asset.id) });
    return assets;
  }

  private async processScenes(payload: StoryStagePayload) {
    const [project, script] = await Promise.all([
      this.projectService.getProjectOrThrow(payload.projectId),
      this.getScriptOrThrow(payload.projectId)
    ]);

    if (project.facelessSource === "reddit_trending") {
      throw new AppError("Reddit story projects render against the provided background video and skip scene generation.", 409, "REDDIT_SCENES_NOT_REQUIRED");
    }

    const response = await this.pythonWorkerClient.requestFacelessScenes({
      jobId: payload.jobId,
      projectId: payload.projectId,
      projectTitle: project.title,
      outputBucket: this.outputBucketForProject(project),
      scenes: this.toPythonScenes(script.scenes),
      visualStyle: project.stylePreset
    });

    const assets = await this.facelessVideoRepository.replaceAssets(
      payload.projectId,
      ["scene_image"],
      response.images.map((image) => ({
        assetType: "scene_image",
        sceneIndex: image.scene_index,
        prompt: image.prompt,
        absolutePath: image.image_path,
        url: image.image_url,
        mimeType: "image/png"
      }))
    );

    await this.markJobCompleted(payload.jobId, { assetIds: assets.map((asset) => asset.id) });
    return assets;
  }

  private async processRender(payload: StoryStagePayload) {
    const [project, script, sceneImages, audioAsset, subtitleAsset] = await Promise.all([
      this.projectService.getProjectOrThrow(payload.projectId),
      this.getScriptOrThrow(payload.projectId),
      this.facelessVideoRepository.findAssets(payload.projectId, { assetType: "scene_image" }),
      this.getAssetOrThrow(payload.projectId, "narration_audio"),
      this.facelessVideoRepository.findLatestAssetByType(payload.projectId, "subtitle_ass")
    ]);

    const imagePaths = sceneImages
      .map((asset) => asset.absolutePath)
      .filter((assetPath): assetPath is string => typeof assetPath === "string" && assetPath.length > 0);

    if (project.facelessSource !== "reddit_trending" && imagePaths.length === 0) {
      throw new AppError("Scene images are required before rendering.", 409, "SCENE_IMAGES_REQUIRED");
    }
    if (!audioAsset.absolutePath) {
      throw new AppError("Narration audio is required before rendering.", 409, "AUDIO_REQUIRED");
    }

    await this.facelessVideoRepository.upsertRender(payload.projectId, { status: "rendering" });

    const response = await this.pythonWorkerClient.requestFacelessRender({
      jobId: payload.jobId,
      projectId: payload.projectId,
      projectTitle: project.title,
      outputBucket: this.outputBucketForProject(project),
      scenes: this.toPythonScenes(script.scenes),
      imagePaths,
      audioPath: audioAsset.absolutePath,
      subtitlesPath: subtitleAsset?.absolutePath,
      renderMode: project.facelessSource === "reddit_trending" ? "background_video" : "scene_images"
    });

    const [render, assets] = await Promise.all([
      this.facelessVideoRepository.upsertRender(payload.projectId, {
        status: "completed",
        videoPath: response.video_path,
        videoUrl: response.video_url,
        durationSeconds: response.duration_seconds,
        completedAt: new Date(),
        errorMessage: undefined
      }),
      this.facelessVideoRepository.replaceAssets(payload.projectId, ["final_video"], [
        {
          assetType: "final_video",
          absolutePath: response.video_path,
          url: response.video_url,
          mimeType: "video/mp4",
          metadata: { durationSeconds: response.duration_seconds }
        }
      ])
    ]);

    await this.projectService.updateWorkflow(payload.projectId, "completed", "completed");
    await this.markJobCompleted(payload.jobId, {
      renderId: render.id,
      assetIds: assets.map((asset) => asset.id)
    });
    return render;
  }

  private async buildRedditStoryScript(payload: StoryStagePayload, project: ProjectDocument) {
    const redditSource = project.redditSource;
    if (!redditSource) {
      throw new AppError("Reddit source metadata is missing for this project.", 409, "REDDIT_SOURCE_REQUIRED");
    }

    const sceneChunks = this.buildRedditSceneChunks({
      title: redditSource.title,
      body: redditSource.body,
      maxDurationSeconds: project.targetDurationSeconds ?? undefined
    });

    const title = project.title?.trim() || redditSource.title;
    const narration = [redditSource.title, ...sceneChunks.map((scene) => scene.narration)].join("\n\n");
    const captionText = redditSource.body;

    const script = await this.facelessVideoRepository.upsertScript(payload.projectId, {
      title,
      hook: redditSource.title,
      narration,
      captionText,
      imagePrompts: [],
      scenes: sceneChunks
    });

    await this.projectService.updateProject(payload.projectId, {
      title,
      topic: redditSource.title,
      workflowStage: "script",
      status: "writing_script"
    });

    return script;
  }

  private buildRedditSceneChunks(input: {
    title: string;
    body: string;
    maxDurationSeconds?: number;
  }) {
    const cleanedParagraphs = input.body
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
      .filter((paragraph) => paragraph.length > 0);

    const rawParts = cleanedParagraphs.length ? cleanedParagraphs : [input.body.replace(/\s+/g, " ").trim()];
    const chunks: string[] = [];
    const maxStoryWords = input.maxDurationSeconds
      ? Math.max(Math.round(input.maxDurationSeconds * 2.35), 70)
      : Number.POSITIVE_INFINITY;
    let acceptedWords = 0;

    for (const part of rawParts) {
      if (this.wordCount(part) <= 55) {
        if (acceptedWords >= maxStoryWords) {
          break;
        }

        chunks.push(part);
        acceptedWords += this.wordCount(part);
        continue;
      }

      const sentences = part.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
      let buffer = "";

      for (const sentence of sentences) {
        const candidate = buffer ? `${buffer} ${sentence}` : sentence;
        if (this.wordCount(candidate) <= 55) {
          buffer = candidate;
          continue;
        }

        if (buffer) {
          if (acceptedWords >= maxStoryWords) {
            break;
          }
          chunks.push(buffer);
          acceptedWords += this.wordCount(buffer);
        }
        buffer = sentence;
      }

      if (buffer && acceptedWords < maxStoryWords) {
        chunks.push(buffer);
        acceptedWords += this.wordCount(buffer);
      }

      if (acceptedWords >= maxStoryWords) {
        break;
      }
    }

    const usableChunks = chunks.filter((chunk) => chunk.length > 0);
    const totalWords = Math.max(this.wordCount(usableChunks.join(" ")), 1);
    const estimatedStoryDuration = Math.max(Number((totalWords / 2.35).toFixed(2)), 15);
    const totalDuration = input.maxDurationSeconds
      ? Math.min(estimatedStoryDuration, input.maxDurationSeconds)
      : estimatedStoryDuration;

    return usableChunks.map((chunk, index) => {
      const words = Math.max(this.wordCount(chunk), 1);
      const proportionalDuration = Number(((words / totalWords) * totalDuration).toFixed(2));

      return {
        sceneIndex: index + 1,
        narration: chunk,
        imagePrompt: "Use the configured Reddit background gameplay video.",
        durationSeconds: Math.max(proportionalDuration, 3),
        captionText: chunk
      };
    });
  }

  private wordCount(value: string) {
    return value.split(/\s+/).filter(Boolean).length;
  }

  private redditSpeakingRate(narration: string) {
    const normalized = narration.toLowerCase();
    const horrorSignals = ["terrified", "horror", "murder", "blood", "creepy", "panic", "ambulance", "overdosed"];
    const sadSignals = ["cry", "heartbroken", "grief", "funeral", "depressed", "lonely", "regret"];
    const dramaticSignals = ["caught", "exposed", "revenge", "affair", "fired", "wedding", "cheated"];

    if (horrorSignals.some((signal) => normalized.includes(signal))) {
      return 0.98;
    }

    if (sadSignals.some((signal) => normalized.includes(signal))) {
      return 1.0;
    }

    if (dramaticSignals.some((signal) => normalized.includes(signal))) {
      return 1.05;
    }

    return 1.03;
  }

  private getNextStage(facelessSource: string | undefined, stage: FacelessStage): FacelessStage | undefined {
    if (facelessSource === "reddit_trending") {
      if (stage === "script") {
        return "audio";
      }
      if (stage === "audio") {
        return "subtitles";
      }
      if (stage === "subtitles") {
        return "render";
      }
      return undefined;
    }

    return NEXT_STAGE[stage];
  }

  private outputBucketForProject(project: Pick<ProjectDocument, "projectType" | "facelessSource">): string {
    if (project.projectType === "uploaded_video") {
      return "clipping";
    }
    if (project.facelessSource === "reddit_trending") {
      return "reddit";
    }
    return "faceless_story";
  }

  private async getScriptOrThrow(projectId: string) {
    const script = await this.facelessVideoRepository.findScript(projectId);
    if (!script) {
      throw new AppError("Generate a script before running this stage.", 409, "SCRIPT_REQUIRED");
    }
    return script;
  }

  private async getAssetOrThrow(projectId: string, assetType: StoryAssetType): Promise<StoryAssetDocument> {
    const asset = await this.facelessVideoRepository.findLatestAssetByType(projectId, assetType);
    if (!asset) {
      throw new AppError(`${assetType} asset is required before running this stage.`, 409, "ASSET_REQUIRED");
    }
    return asset;
  }

  private toPythonScenes(
    scenes: Array<{
      sceneIndex: number;
      narration: string;
      imagePrompt: string;
      durationSeconds: number;
      captionText: string;
    }>
  ): PythonFacelessScene[] {
    return scenes.map((scene) => ({
      scene_index: scene.sceneIndex,
      narration: scene.narration,
      image_prompt: scene.imagePrompt,
      duration_seconds: scene.durationSeconds,
      caption_text: scene.captionText
    }));
  }

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
    const message = this.errorMessage(error);
    await this.jobService.updateJob(jobId, {
      status: "failed",
      completedAt: new Date(),
      errorMessage: message
    });
  }

  private errorMessage(error: unknown): string {
    if (typeof error === "object" && error !== null) {
      const record = error as Record<string, unknown>;
      const response = record.response as { data?: unknown; status?: unknown } | undefined;
      const responseStatus = response?.status ?? "unknown";
      const responseData = response?.data;
      if (typeof responseData === "object" && responseData !== null) {
        const errorRecord = responseData as { error?: { message?: unknown; code?: unknown } };
        if (typeof errorRecord.error?.message === "string" && errorRecord.error.message.trim().length > 0) {
          return errorRecord.error.message;
        }
        return `Worker request failed with status ${responseStatus}: ${JSON.stringify(responseData)}`;
      }
      if (responseData !== undefined) {
        return `Worker request failed with status ${responseStatus}: ${String(responseData)}`;
      }
      if (record.code) {
        return `Worker request failed with code ${String(record.code)}.`;
      }
    }

    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }

    return "Unknown worker error.";
  }
}
