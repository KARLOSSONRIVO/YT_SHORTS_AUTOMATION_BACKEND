import type { Request, Response } from "express";
import { sendSuccess } from "../../../common/utils/api-response";
import { FacelessVideoService, type FacelessStage } from "../../services/facelessVideo/faceless-video.service";
import { ProjectService } from "../../services/project/project.service";

export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly facelessVideoService: FacelessVideoService
  ) {}

  public createProject = async (request: Request, response: Response): Promise<void> => {
    const project = await this.facelessVideoService.createProject(request.body);
    sendSuccess(response, project, 201);
  };

  public listProjects = async (request: Request, response: Response): Promise<void> => {
    const userId = typeof request.query.userId === "string" ? request.query.userId : undefined;
    const projects = await this.projectService.listProjects(userId);
    sendSuccess(response, projects);
  };

  public getProject = async (request: Request, response: Response): Promise<void> => {
    const project = await this.projectService.getProjectOrThrow(String(request.params.projectId));
    sendSuccess(response, project);
  };

  public getProjectStatus = async (request: Request, response: Response): Promise<void> => {
    const status = await this.facelessVideoService.getProjectStatus(String(request.params.projectId));
    sendSuccess(response, status);
  };

  public generateScript = async (request: Request, response: Response): Promise<void> => {
    await this.enqueueFacelessStage(request, response, "script");
  };

  public runFacelessAutomation = async (request: Request, response: Response): Promise<void> => {
    const job = await this.facelessVideoService.startAutomation(String(request.params.projectId));
    sendSuccess(response, job, 202);
  };

  public generateAudio = async (request: Request, response: Response): Promise<void> => {
    await this.enqueueFacelessStage(request, response, "audio");
  };

  public generateSubtitles = async (request: Request, response: Response): Promise<void> => {
    await this.enqueueFacelessStage(request, response, "subtitles");
  };

  public generateScenes = async (request: Request, response: Response): Promise<void> => {
    await this.enqueueFacelessStage(request, response, "scenes");
  };

  public render = async (request: Request, response: Response): Promise<void> => {
    await this.enqueueFacelessStage(request, response, "render");
  };

  public listAssets = async (request: Request, response: Response): Promise<void> => {
    const assets = await this.facelessVideoService.listAssets(String(request.params.projectId));
    sendSuccess(response, assets);
  };

  private async enqueueFacelessStage(request: Request, response: Response, stage: FacelessStage): Promise<void> {
    const job = await this.facelessVideoService.enqueueStage(String(request.params.projectId), stage);
    sendSuccess(response, job, 202);
  }
}
