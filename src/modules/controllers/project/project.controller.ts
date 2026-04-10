import type { Request, Response } from "express";
import { sendSuccess } from "../../../common/utils/api-response";
import { ProjectService } from "../../services/project/project.service";

export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  public listProjects = async (request: Request, response: Response): Promise<void> => {
    const userId = typeof request.query.userId === "string" ? request.query.userId : undefined;
    const projects = await this.projectService.listProjects(userId);
    sendSuccess(response, projects);
  };

  public getProject = async (request: Request, response: Response): Promise<void> => {
    const project = await this.projectService.getProjectOrThrow(String(request.params.projectId));
    sendSuccess(response, project);
  };
}
