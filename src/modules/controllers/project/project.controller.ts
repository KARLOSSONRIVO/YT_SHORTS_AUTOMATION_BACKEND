import type { Request, Response } from "express";
import { sendSuccess } from "../../../common/utils/api-response";
import { ProjectService } from "../../services/project/project.service";

export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  public listProjects = async (request: Request, response: Response): Promise<void> => {
    const projects = await this.projectService.listProjects(request.query.userId as string | undefined);
    sendSuccess(response, projects);
  };

  public getProject = async (request: Request, response: Response): Promise<void> => {
    const project = await this.projectService.getProjectOrThrow(request.params.projectId);
    sendSuccess(response, project);
  };
}
