import { NotFoundError } from "../../../common/errors/not-found-error";
import { ProjectRepository } from "../../repositories/project.repository";
import {
  DEFAULT_PROJECT_SUBTITLE_PREFERENCES,
  type RedditSourceMetadata,
  type ProjectSubtitlePreferences
} from "../../models/project.model";

export interface CreateProjectInput {
  userId: string;
  title: string;
  description?: string;
  hashtags?: string;
  targetClipCount?: number;
  subtitlePreferences?: Partial<ProjectSubtitlePreferences>;
}

export interface CreateFacelessStoryProjectInput {
  userId: string;
  title?: string;
  description?: string;
  topic: string;
  platforms?: Array<"youtube" | "tiktok">;
  targetDurationSeconds?: number;
  stylePreset?: string;
  scriptFramework?: "psychology_truth" | "history_story";
  facelessRenderMode?: "image_story" | "animation_story";
  voice?: string;
  tone?: string;
  audience?: string;
  subtitlePreferences?: Partial<ProjectSubtitlePreferences>;
}

export interface CreateRedditStoryProjectInput {
  userId: string;
  title?: string;
  description?: string;
  subreddit: string;
  maxDurationSeconds?: number;
  voice?: string;
  subtitlePreferences?: Partial<ProjectSubtitlePreferences>;
  redditSource: RedditSourceMetadata;
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
      platforms: ["youtube"],
      subtitlePreferences: {
        ...DEFAULT_PROJECT_SUBTITLE_PREFERENCES,
        ...input.subtitlePreferences
      },
      status: "processing",
      workflowStage: "ingest"
    });
  }

  public createFacelessStoryProject(input: CreateFacelessStoryProjectInput) {
    return this.projectRepository.create({
      userId: input.userId as never,
      title: input.title ?? input.topic,
      description: input.description,
      projectType: "faceless_story",
      facelessSource: "topic",
      topic: input.topic,
      platforms: input.platforms ?? ["youtube"],
      targetDurationSeconds: input.targetDurationSeconds ?? 45,
      stylePreset: input.stylePreset ?? "cinematic documentary",
      scriptFramework: input.scriptFramework ?? "psychology_truth",
      facelessRenderMode: input.facelessRenderMode ?? "image_story",
      voice: input.voice ?? "af_sarah",
      tone: input.tone,
      audience: input.audience,
      subtitlePreferences: {
        ...DEFAULT_PROJECT_SUBTITLE_PREFERENCES,
        ...input.subtitlePreferences
      },
      status: "draft",
      workflowStage: "draft"
    });
  }

  public createRedditStoryProject(input: CreateRedditStoryProjectInput) {
    return this.projectRepository.create({
      userId: input.userId as never,
      title: input.title ?? input.redditSource.title,
      description: input.description,
      projectType: "faceless_story",
      facelessSource: "reddit_trending",
      topic: input.redditSource.title,
      platforms: ["youtube"],
      targetDurationSeconds: input.maxDurationSeconds,
      stylePreset: "reddit story gameplay",
      voice: input.voice ?? "af_sarah",
      redditSource: input.redditSource,
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

  public updateWorkflow(projectId: string, workflowStage: string, status: string) {
    return this.projectRepository.updateById(projectId, {
      workflowStage: workflowStage as never,
      status: status as never
    });
  }

  public updateProject(projectId: string, payload: Record<string, unknown>) {
    return this.projectRepository.updateById(projectId, payload as never);
  }
}
