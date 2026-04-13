import { AppError } from "../../../common/errors/app-error";
import { QUEUE_NAMES } from "../../../infrastructure/queue/queue.names";
import {
  type PythonFacelessScene,
  type PythonWorkerClient
} from "../../../infrastructure/pythonWorker/python-worker.client";
import { type StoryAssetDocument, type StoryAssetType } from "../../models/story-asset.model";
import { FacelessVideoRepository } from "../../repositories/faceless-video.repository";
import { JobService } from "../job/job.service";
import { ProjectService } from "../project/project.service";
import { QueueService } from "../queue/queue.service";

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
    private readonly facelessVideoRepository: FacelessVideoRepository
  ) {}

  public createProject(input: CreateFacelessProjectInput) {
    return this.projectService.createFacelessStoryProject(input);
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
        const nextStage = NEXT_STAGE[payload.stage];
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
    if (!project.topic) {
      throw new AppError("A topic is required before generating a faceless script.", 409, "TOPIC_REQUIRED");
    }

    const response = await this.pythonWorkerClient.requestFacelessScript({
      jobId: payload.jobId,
      projectId: payload.projectId,
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
      narration: script.narration,
      voice: project.voice
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
    const [script, audioAsset] = await Promise.all([
      this.getScriptOrThrow(payload.projectId),
      this.facelessVideoRepository.findLatestAssetByType(payload.projectId, "narration_audio")
    ]);

    const response = await this.pythonWorkerClient.requestFacelessSubtitles({
      jobId: payload.jobId,
      projectId: payload.projectId,
      audioPath: audioAsset?.absolutePath,
      scenes: this.toPythonScenes(script.scenes)
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
    const [script, sceneImages, audioAsset, subtitleAsset] = await Promise.all([
      this.getScriptOrThrow(payload.projectId),
      this.facelessVideoRepository.findAssets(payload.projectId, { assetType: "scene_image" }),
      this.getAssetOrThrow(payload.projectId, "narration_audio"),
      this.facelessVideoRepository.findLatestAssetByType(payload.projectId, "subtitle_ass")
    ]);

    const imagePaths = sceneImages
      .map((asset) => asset.absolutePath)
      .filter((assetPath): assetPath is string => typeof assetPath === "string" && assetPath.length > 0);

    if (imagePaths.length === 0) {
      throw new AppError("Scene images are required before rendering.", 409, "SCENE_IMAGES_REQUIRED");
    }
    if (!audioAsset.absolutePath) {
      throw new AppError("Narration audio is required before rendering.", 409, "AUDIO_REQUIRED");
    }

    await this.facelessVideoRepository.upsertRender(payload.projectId, { status: "rendering" });

    const response = await this.pythonWorkerClient.requestFacelessRender({
      jobId: payload.jobId,
      projectId: payload.projectId,
      scenes: this.toPythonScenes(script.scenes),
      imagePaths,
      audioPath: audioAsset.absolutePath,
      subtitlesPath: subtitleAsset?.absolutePath
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
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }

    if (typeof error === "object" && error !== null) {
      const record = error as Record<string, unknown>;
      const response = record.response as { data?: unknown; status?: unknown } | undefined;
      if (response?.data) {
        return `Worker request failed with status ${response.status ?? "unknown"}: ${JSON.stringify(response.data)}`;
      }
      if (record.code) {
        return `Worker request failed with code ${String(record.code)}.`;
      }
    }

    return "Unknown worker error.";
  }
}
