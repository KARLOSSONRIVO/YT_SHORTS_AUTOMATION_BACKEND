import { AppError } from "../../../common/errors/app-error";
import { QUEUE_NAMES } from "../../../infrastructure/queue/queue.names";
import {
  type PythonFacelessScene,
  type PythonWorkerClient
} from "../../../infrastructure/pythonWorker/python-worker.client";
import { type ProjectDocument } from "../../models/project.model";
import { type StoryAssetDocument, type StoryAssetType } from "../../models/story-asset.model";
import { FacelessVideoRepository } from "../../repositories/faceless-video.repository";
import { JobService } from "../job/job.service";
import { ProjectService } from "../project/project.service";
import { QueueService } from "../queue/queue.service";
import { isRateLimitFailure } from "../../automation/retry-policy";
import type { ContentType, ScriptFramework, SerializedStoryAssignment } from "../../automation/automation.types";

export type FacelessStage = "script" | "audio" | "subtitles" | "scenes" | "animations" | "ambience" | "render";

export interface CreateFacelessProjectInput {
  parentProjectId: string;
  userId: string;
  title?: string;
  description?: string;
  topic: string;
  platforms?: Array<"youtube" | "tiktok">;
  targetDurationSeconds?: number;
  stylePreset?: string;
  scriptFramework?: ScriptFramework;
  facelessRenderMode?: "image_story" | "animation_story" | "background_video";
  voice?: string;
  tone?: string;
  audience?: string;
  language?: string;
  storyFormat?: string;
  speakingRate?: number;
  fallbackVoice?: string;
  contentType?: ContentType;
  nicheId?: string;
  sourceText?: string;
  experimentVariant?: string;
  nextStoryTitle?: string;
  nextStoryTopic?: string;
  serializedStoryAssignment?: SerializedStoryAssignment;
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
  animations: { workflowStage: "animations", status: "animating_scenes" },
  ambience: { workflowStage: "ambience", status: "animating_scenes" },
  render: { workflowStage: "render", status: "rendering" }
};

const NEXT_STAGE: Partial<Record<FacelessStage, FacelessStage>> = {
  script: "audio",
  audio: "subtitles",
  subtitles: "scenes",
  scenes: "render",
  animations: "ambience",
  ambience: "render"
};

export class FacelessVideoService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly jobService: JobService,
    private readonly queueService: QueueService,
    private readonly pythonWorkerClient: PythonWorkerClient,
    private readonly facelessVideoRepository: FacelessVideoRepository
  ) {}

  public createGeneratedStoryProject(input: CreateFacelessProjectInput) {
    return this.projectService.createGeneratedStoryProject(input);
  }

  public async enqueueStage(projectId: string, stage: FacelessStage, options: { autoRun?: boolean } = {}) {
    await this.projectService.getProjectOrThrow(projectId);
    const existingJob = (await this.jobService.listByProjectId(projectId))
      .find((job) => job.type === `faceless.${stage}`);
    if (existingJob && ["queued", "active", "completed"].includes(existingJob.status)) {
      if (existingJob.status !== "completed") {
        const enqueuedJob = await this.queueService.addStoryJob({
          jobId: existingJob.id,
          projectId,
          stage,
          autoRun: options.autoRun ?? false
        }, { jobId: existingJob.id });
        if (String(existingJob.externalJobId) !== String(enqueuedJob.id)) {
          await this.jobService.updateJob(existingJob.id, { externalJobId: `${enqueuedJob.id}` });
        }
      }
      return existingJob;
    }

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
        case "animations":
          result = await this.processAnimations(payload);
          break;
        case "ambience":
          result = await this.processAmbience(payload);
          break;
        case "render":
          result = await this.processRender(payload);
          break;
        default:
          throw new AppError("Unsupported faceless video stage.", 400, "UNSUPPORTED_FACELESS_STAGE");
      }

      if (payload.autoRun) {
        const project = await this.projectService.getProjectOrThrow(payload.projectId);
        const nextStage = this.getNextStage(project, payload.stage);
        if (nextStage) {
          const nextJob = await this.enqueueStage(payload.projectId, nextStage, { autoRun: true });
          return { result, nextJob };
        }
      }

      return result;
    } catch (error) {
      if (isRateLimitFailure(error)) {
        await this.projectService.updateProject(payload.projectId, { status: "queued" });
        await this.jobService.updateJob(payload.jobId, {
          status: "queued",
          errorMessage: "AI provider rate limit reached. This step is queued and will retry after 30, 60, then 120 seconds.",
          progress: { message: "Rate limited by the AI provider; waiting to resume this step." }
        });
        throw error;
      }
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
    if (!project.topic) {
      throw new AppError("A topic is required before generating a faceless script.", 409, "TOPIC_REQUIRED");
    }

    const response = await this.pythonWorkerClient.requestFacelessScript({
      jobId: payload.jobId,
      projectId: payload.projectId,
      projectTitle: project.title,
      topic: project.topic,
      tone: project.tone,
      audience: project.audience,
      language: project.language,
      storyFormat: project.storyFormat,
      speakingRate: project.speakingRate,
      targetDurationSeconds: project.targetDurationSeconds,
      stylePreset: project.stylePreset,
      scriptFramework: this.effectiveScriptFramework(project),
      sourceText: project.sourceText ?? project.description,
      nicheId: project.nicheId,
      experimentVariant: project.experimentVariant,
      nextStoryTitle: project.nextStoryTitle,
      nextStoryTopic: project.nextStoryTopic,
      serializedStory: project.serializedStoryAssignment
    });

    const scriptTitle = project.contentType === "REDDIT_STORY" || this.effectiveScriptFramework(project) === "serialized_story" ? project.title : response.title;
    const script = await this.facelessVideoRepository.upsertScript(payload.projectId, {
      title: scriptTitle,
      hook: response.hook,
      narration: response.narration,
      captionText: response.caption_text,
      imagePrompts: response.scenes.map((scene) => scene.image_prompt),
      scenes: response.scenes.map((scene) => ({
        sceneIndex: scene.scene_index,
        narration: scene.narration,
        imagePrompt: scene.image_prompt,
        durationSeconds: scene.duration_seconds,
        captionText: scene.caption_text
      }))
    });

    await this.projectService.updateProject(payload.projectId, {
      title: scriptTitle,
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

    const audioRequest = {
      jobId: payload.jobId,
      projectId: payload.projectId,
      projectTitle: project.title,
      outputBucket: this.outputBucketForProject(project),
      narration: this.narrationWithOpeningPause(script),
      voice: project.voice,
      speakingRate: project.speakingRate
    };
    let response;
    try { response = await this.pythonWorkerClient.requestFacelessAudio(audioRequest); }
    catch (error) {
      if (!project.fallbackVoice || project.fallbackVoice === project.voice) throw error;
      response = await this.pythonWorkerClient.requestFacelessAudio({ ...audioRequest, voice: project.fallbackVoice });
    }

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
      openingDisplayText: script.hook,
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

  private async processAnimations(payload: StoryStagePayload) {
    const [project, script] = await Promise.all([
      this.projectService.getProjectOrThrow(payload.projectId),
      this.getScriptOrThrow(payload.projectId)
    ]);

    if (project.facelessRenderMode !== "animation_story") {
      throw new AppError("This project is configured for image story rendering.", 409, "ANIMATION_NOT_ENABLED");
    }

    const pythonScenes = this.toPythonScenes(script.scenes);
    const completedScenes: number[] = [];
    const animations: Array<{
      scene_index: number;
      prompt: string;
      source_image_path: string;
      video_path: string;
      video_url: string;
      cache_key: string;
    }> = [];

    await this.updateJobProgress(payload.jobId, {
      total: pythonScenes.length,
      current: 0,
      percent: 0,
      completedScenes,
      message: `Preparing ${pythonScenes.length} text-to-video scene animation${pythonScenes.length === 1 ? "" : "s"}.`
    });

    for (const [index, scene] of pythonScenes.entries()) {
      const sceneIndex = scene.scene_index;

      await this.updateJobProgress(payload.jobId, {
        total: pythonScenes.length,
        current: index,
        percent: this.progressPercent(index, pythonScenes.length),
        currentSceneIndex: sceneIndex,
        completedScenes,
        message: `Generating text-to-video scene ${index + 1} of ${pythonScenes.length}.`
      });

      const response = await this.pythonWorkerClient.requestFacelessAnimations({
        jobId: payload.jobId,
        projectId: payload.projectId,
        projectTitle: project.title,
        outputBucket: this.outputBucketForProject(project),
        scenes: [scene],
        animationStyle: project.stylePreset
      });

      animations.push(...response.animations);
      completedScenes.push(sceneIndex);

      await this.updateJobProgress(payload.jobId, {
        total: pythonScenes.length,
        current: index + 1,
        percent: this.progressPercent(index + 1, pythonScenes.length),
        currentSceneIndex: sceneIndex,
        completedScenes: [...completedScenes],
        message: `Finished text-to-video scene ${index + 1} of ${pythonScenes.length}.`
      });
    }

    const assets = await this.facelessVideoRepository.replaceAssets(
      payload.projectId,
      ["scene_animation"],
      animations.map((animation) => ({
        assetType: "scene_animation",
        sceneIndex: animation.scene_index,
        prompt: animation.prompt,
        absolutePath: animation.video_path,
        url: animation.video_url,
        mimeType: "video/mp4",
        metadata: {
          sourceImagePath: animation.source_image_path,
          cacheKey: animation.cache_key
        }
      }))
    );

    await this.markJobCompleted(payload.jobId, {
      assetIds: assets.map((asset) => asset.id),
      generatedScenes: completedScenes.length,
      totalScenes: pythonScenes.length
    });
    return assets;
  }

  private async processAmbience(payload: StoryStagePayload) {
    const [project, script] = await Promise.all([
      this.projectService.getProjectOrThrow(payload.projectId),
      this.getScriptOrThrow(payload.projectId)
    ]);

    if (project.facelessRenderMode !== "animation_story") {
      throw new AppError("AI ambience is only enabled for animation story projects.", 409, "AMBIENCE_NOT_ENABLED");
    }

    const response = await this.pythonWorkerClient.requestFacelessAmbience({
      jobId: payload.jobId,
      projectId: payload.projectId,
      projectTitle: project.title,
      outputBucket: this.outputBucketForProject(project),
      scenes: this.toPythonScenes(script.scenes),
      outputFormat: "wav"
    });

    const assets = await this.facelessVideoRepository.replaceAssets(
      payload.projectId,
      ["scene_ambience"],
      response.ambience.map((ambience) => ({
        assetType: "scene_ambience",
        sceneIndex: ambience.scene_index,
        prompt: ambience.prompt,
        absolutePath: ambience.audio_path,
        url: ambience.audio_url ?? undefined,
        mimeType: "audio/wav",
        metadata: {
          durationSeconds: ambience.duration_seconds,
          cacheKey: ambience.cache_key,
          mood: ambience.mood,
          environment: ambience.environment,
          emotionalTone: ambience.emotional_tone,
          tensionLevel: ambience.tension_level
        }
      }))
    );

    await this.markJobCompleted(payload.jobId, { assetIds: assets.map((asset) => asset.id) });
    return assets;
  }

  private async processRender(payload: StoryStagePayload) {
    const [project, script, sceneImages, sceneAnimations, ambienceAssets, audioAsset, subtitleAsset] = await Promise.all([
      this.projectService.getProjectOrThrow(payload.projectId),
      this.getScriptOrThrow(payload.projectId),
      this.facelessVideoRepository.findAssets(payload.projectId, { assetType: "scene_image" }),
      this.facelessVideoRepository.findAssets(payload.projectId, { assetType: "scene_animation" }),
      this.facelessVideoRepository.findAssets(payload.projectId, { assetType: "scene_ambience" }),
      this.getAssetOrThrow(payload.projectId, "narration_audio"),
      this.facelessVideoRepository.findLatestAssetByType(payload.projectId, "subtitle_ass")
    ]);

    const imagePaths = sceneImages
      .map((asset) => asset.absolutePath)
      .filter((assetPath): assetPath is string => typeof assetPath === "string" && assetPath.length > 0);
    const animationPaths = sceneAnimations
      .map((asset) => asset.absolutePath)
      .filter((assetPath): assetPath is string => typeof assetPath === "string" && assetPath.length > 0);
    const ambiencePaths = ambienceAssets
      .map((asset) => asset.absolutePath)
      .filter((assetPath): assetPath is string => typeof assetPath === "string" && assetPath.length > 0);

    if (project.facelessRenderMode === "image_story" && imagePaths.length === 0) {
      throw new AppError("Scene images are required before rendering.", 409, "SCENE_IMAGES_REQUIRED");
    }
    if (project.facelessRenderMode === "animation_story" && animationPaths.length === 0) {
      throw new AppError("Scene animations are required before rendering an animation story.", 409, "SCENE_ANIMATIONS_REQUIRED");
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
      sceneVideoPaths: animationPaths,
      audioPath: audioAsset.absolutePath,
      subtitlesPath: subtitleAsset?.absolutePath,
      ambienceAudioPaths: project.facelessRenderMode === "animation_story" ? ambiencePaths : [],
      renderMode: project.facelessRenderMode === "background_video"
        ? "background_video"
        : project.facelessRenderMode === "animation_story" ? "animation_story" : "scene_images"
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
    if (project.parentProjectId && project.serializedStoryAssignment) {
      await this.projectService.advanceSerializedStory(String(project.parentProjectId), project.serializedStoryAssignment);
    }
    await this.markJobCompleted(payload.jobId, {
      renderId: render.id,
      assetIds: assets.map((asset) => asset.id)
    });
    return render;
  }

  private narrationWithOpeningPause(
    script: { title: string; hook: string; narration: string }
  ) {
    const narration = script.narration.trim();
    if (!narration) {
      return narration;
    }

    const openingCandidates = [script.hook, script.title];

    for (const openingCandidate of openingCandidates) {
      const withPause = this.insertPauseAfterOpeningText(narration, openingCandidate);
      if (withPause) {
        return withPause;
      }
    }

    const preferredOpening = script.hook.trim() || script.title.trim();
    if (preferredOpening) {
      return `${preferredOpening}\n\n${narration}`;
    }

    return this.insertPauseAfterFirstSentence(narration) ?? narration;
  }

  private insertPauseAfterOpeningText(narration: string, openingCandidate?: string) {
    const opening = openingCandidate?.trim();
    if (!opening) {
      return undefined;
    }

    const lowerNarration = narration.toLowerCase();
    const lowerOpening = opening.toLowerCase();
    if (!lowerNarration.startsWith(lowerOpening)) {
      return undefined;
    }

    const beforePause = narration.slice(0, opening.length).trim();
    const afterPause = narration.slice(opening.length).trim();
    if (!beforePause || !afterPause) {
      return undefined;
    }

    return `${beforePause}\n\n${afterPause}`;
  }

  private insertPauseAfterFirstSentence(narration: string) {
    const match = narration.match(/^(.+?[.!?])\s+(.+)$/s);
    if (!match?.[1] || !match[2]) {
      return undefined;
    }

    return `${match[1].trim()}\n\n${match[2].trim()}`;
  }

  private getNextStage(
    project: Pick<ProjectDocument, "facelessSource" | "facelessRenderMode">,
    stage: FacelessStage
  ): FacelessStage | undefined {
    if (stage === "scenes" && project.facelessRenderMode === "animation_story") {
      return "animations";
    }
    if (stage === "subtitles") {
      if (project.facelessRenderMode === "background_video") return "render";
      if (project.facelessRenderMode === "animation_story") return "animations";
    }

    return NEXT_STAGE[stage];
  }

  private effectiveScriptFramework(
    project: Pick<ProjectDocument, "facelessSource" | "scriptFramework" | "contentType">
  ): ScriptFramework {
    if (project.contentType === "REDDIT_STORY") return "reddit_story";
    return project.scriptFramework ?? "psychology_truth";
  }

  private outputBucketForProject(project: Pick<ProjectDocument, "projectType" | "facelessSource" | "contentType">): string {
    if (project.projectType === "uploaded_video") {
      return "clipping";
    }
    if (project.contentType === "REDDIT_STORY") {
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

  private async updateJobProgress(
    jobId: string,
    progress: {
      total?: number;
      current?: number;
      percent?: number;
      message?: string;
      currentSceneIndex?: number;
      completedScenes?: number[];
    }
  ) {
    await this.jobService.updateJob(jobId, { progress });
  }

  private progressPercent(current: number, total: number) {
    if (total <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
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
