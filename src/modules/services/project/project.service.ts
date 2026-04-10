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

export class ProjectService {
  constructor(private readonly projectRepository: ProjectRepository) {}

  public createProject(input: CreateProjectInput) {
    return this.projectRepository.create({
      userId: input.userId as never,
      title: input.title,
      description: input.description,
      subtitlePreferences: {
        ...DEFAULT_PROJECT_SUBTITLE_PREFERENCES,
        ...input.subtitlePreferences
      },
      status: "processing",
      workflowStage: "ingest"
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
}
