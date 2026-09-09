import { NotFoundError } from "../../../common/errors/not-found-error";
import { ProjectRepository } from "../../repositories/project.repository";
import { DEFAULT_PROJECT_SUBTITLE_PREFERENCES, type ProjectSubtitlePreferences } from "../../models/project.model";
import type { AutomationMode, ContentType, ScriptFramework, SerializedStoryAssignment, StoryFormat, VisualType } from "../../automation/automation.types";
import { createSerializedStoryState, isOriginalSerializedMystery } from "../../automation/serialized-story";

export interface CreateProjectInput {
  userId: string;
  title: string;
  description?: string;
  hashtags?: string;
  targetClipCount?: number;
  subtitlePreferences?: Partial<ProjectSubtitlePreferences>;
}

export interface CreateFacelessStoryProjectInput {
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
  subtitlePreferences?: Partial<ProjectSubtitlePreferences>;
}

export interface CreateAutomationProjectInput {
  userId: string;
  name: string;
  contentType: ContentType;
  nicheId?: string;
  accountId: string;
  language: string;
  timezone: string;
  uploadTime: string;
  visualType: VisualType;
  allowedNarrativeFormats?: StoryFormat[];
  automationMode: AutomationMode;
  automationEnabled: boolean;
  nextRunAt?: Date;
  episodesPerSeries?: number;
}

export class ProjectService {
  constructor(private readonly projectRepository: ProjectRepository) {}

  public createProject(input: CreateProjectInput) {
    return this.projectRepository.create({
      userId: input.userId as never,
      title: input.title,
      description: input.description,
      hashtags: input.hashtags,
      targetClipCount: input.targetClipCount ?? 5,
      projectType: "uploaded_video",
      contentType: "CLIP_UPLOAD",
      platforms: ["youtube"],
      subtitlePreferences: {
        ...DEFAULT_PROJECT_SUBTITLE_PREFERENCES,
        ...input.subtitlePreferences
      },
      status: "processing",
      workflowStage: "ingest"
    });
  }

  public createAutomationProject(input: CreateAutomationProjectInput) {
    return this.projectRepository.create({
      userId: input.userId as never,
      title: input.name,
      name: input.name,
      projectType: input.contentType === "CLIP_UPLOAD" ? "uploaded_video" : "faceless_story",
      contentType: input.contentType,
      facelessSource: input.contentType === "CLIP_UPLOAD" ? undefined : "daily_automation",
      nicheId: input.nicheId,
      accountId: input.accountId as never,
      language: input.language,
      timezone: input.timezone,
      uploadTime: input.uploadTime,
      durationSeconds: 60,
      targetDurationSeconds: 60,
      visualType: input.visualType,
      storyFormatMode: "auto_select",
      allowedStoryFormats: input.allowedNarrativeFormats,
      automationMode: input.automationMode,
      automationEnabled: input.automationEnabled,
      automationStatus: input.automationEnabled ? "active" : "paused",
      nextRunAt: input.automationEnabled ? input.nextRunAt : undefined,
      serializedStory: input.contentType === "FACELESS_NICHE" && isOriginalSerializedMystery(input.nicheId) ? createSerializedStoryState(input.episodesPerSeries) : undefined,
      platforms: ["youtube"],
      subtitlePreferences: { ...DEFAULT_PROJECT_SUBTITLE_PREFERENCES },
      status: "draft",
      workflowStage: "draft"
    });
  }

  public createGeneratedStoryProject(input: CreateFacelessStoryProjectInput) {
    return this.projectRepository.create({
      userId: input.userId as never,
      parentProjectId: input.parentProjectId as never,
      internalStory: true,
      title: input.title ?? input.topic,
      description: input.description,
      projectType: "faceless_story",
      contentType: input.contentType ?? "FACELESS_NICHE",
      facelessSource: "daily_automation",
      topic: input.topic,
      nicheId: input.nicheId,
      sourceText: input.sourceText,
      nextStoryTitle: input.nextStoryTitle,
      nextStoryTopic: input.nextStoryTopic,
      platforms: input.platforms ?? ["youtube"],
      targetDurationSeconds: input.targetDurationSeconds ?? 60,
      stylePreset: input.stylePreset ?? "cinematic documentary",
      scriptFramework: input.scriptFramework ?? "psychology_truth",
      facelessRenderMode: input.facelessRenderMode ?? "image_story",
      voice: input.voice ?? "Kore",
      tone: input.tone,
      audience: input.audience,
      language: input.language ?? "en",
      storyFormat: input.storyFormat,
      speakingRate: input.speakingRate,
      fallbackVoice: input.fallbackVoice,
      experimentVariant: input.experimentVariant,
      serializedStoryAssignment: input.serializedStoryAssignment,
      subtitlePreferences: {
        ...DEFAULT_PROJECT_SUBTITLE_PREFERENCES,
        ...input.subtitlePreferences
      },
      status: "draft",
      workflowStage: "draft"
    });
  }

  public async getProjectOrThrow(projectId: string) {
    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      throw new NotFoundError("Project not found.", { projectId });
    }

    return project;
  }

  public listProjects(userId?: string) {
    return this.projectRepository.findMany(userId ? { userId } : {});
  }

  public getOwnedProjectOrThrow(projectId: string, userId: string) {
    return this.projectRepository.findOwnedById(projectId, userId).then((project) => {
      if (!project) throw new NotFoundError("Project not found.", { projectId });
      return project;
    });
  }

  public updateWorkflow(projectId: string, workflowStage: string, status: string) {
    return this.projectRepository.updateById(projectId, {
      workflowStage: workflowStage as never,
      status: status as never
    });
  }

  public updateProject(projectId: string, payload: Record<string, unknown>) {
    return this.projectRepository.updateById(projectId, payload as never);
  }

  public advanceSerializedStory(parentProjectId: string, assignment: SerializedStoryAssignment) {
    return this.projectRepository.advanceSerializedStory(parentProjectId, assignment);
  }

  public findDueProjects(now: Date, limit = 25) { return this.projectRepository.findDue(now, limit); }
  public claimDueProject(projectId: string, expectedNextRunAt: Date, nextRunAt: Date) { return this.projectRepository.claimDue(projectId, expectedNextRunAt, nextRunAt); }
  public listInternalStories(projectId: string) { return this.projectRepository.findInternalStories(projectId); }
}
