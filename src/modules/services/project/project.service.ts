import { NotFoundError } from "../../../common/errors/not-found-error";
import { ProjectRepository } from "../../repositories/project.repository";
import {
  DEFAULT_PROJECT_SUBTITLE_PREFERENCES,
  type ProjectSubtitlePreferences
} from "../../models/project.model";

export interface CreateProjectInput {
  userId: string;
  title: string;
  description?: string;
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
  voice?: string;
  subtitlePreferences?: Partial<ProjectSubtitlePreferences>;
}

export class ProjectService {
  constructor(private readonly projectRepository: ProjectRepository) {}

  public createProject(input: CreateProjectInput) {
    return this.projectRepository.create({
      userId: input.userId as never,
      title: input.title,
      description: input.description,
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
      topic: input.topic,
      platforms: input.platforms ?? ["youtube", "tiktok"],
      targetDurationSeconds: input.targetDurationSeconds ?? 45,
      stylePreset: input.stylePreset ?? "cinematic documentary",
      voice: input.voice ?? "af_sarah",
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
