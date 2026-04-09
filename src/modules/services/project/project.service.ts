import { NotFoundError } from "../../../common/errors/not-found-error";
import { ProjectRepository } from "../../repositories/project.repository";

export interface CreateProjectInput {
  userId: string;
  title: string;
  description?: string;
}

export class ProjectService {
  constructor(private readonly projectRepository: ProjectRepository) {}

  public createProject(input: CreateProjectInput) {
    return this.projectRepository.create({
      userId: input.userId as never,
      title: input.title,
      description: input.description,
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
