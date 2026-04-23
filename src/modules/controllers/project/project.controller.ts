import type { Request, Response } from "express";
import { getAuthenticatedUser } from "../../../common/middlewares/require-auth.middleware";
import { sendSuccess } from "../../../common/utils/api-response";
import { FacelessVideoService, type FacelessStage } from "../../services/facelessVideo/faceless-video.service";
import { PublishService } from "../../services/publish/publish.service";
import { ProjectService } from "../../services/project/project.service";

export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly facelessVideoService: FacelessVideoService,
    private readonly publishService: PublishService
  ) {}

  public createProject = async (request: Request, response: Response): Promise<void> => {
    const project = await this.facelessVideoService.createProject({
      ...request.body,
      userId: getAuthenticatedUser(request).id
    });
    sendSuccess(response, project, 201);
  };

  public createTrendingRedditProject = async (request: Request, response: Response): Promise<void> => {
    const project = await this.facelessVideoService.createTrendingRedditProject({
      ...request.body,
      userId: getAuthenticatedUser(request).id
    });
    sendSuccess(response, project, 201);
  };

  public listProjects = async (request: Request, response: Response): Promise<void> => {
    const projects = await this.projectService.listProjects(getAuthenticatedUser(request).id);
    sendSuccess(response, projects);
  };

  public listVoices = async (_request: Request, response: Response): Promise<void> => {
    const voices = await this.facelessVideoService.listVoices();
    sendSuccess(response, voices);
  };

  public previewVoice = async (request: Request, response: Response): Promise<void> => {
    const preview = await this.facelessVideoService.getVoicePreview(String(request.params.voice));
    response.setHeader("Content-Type", preview.mimeType);
    response.setHeader("Content-Disposition", `inline; filename=\"${preview.fileName}\"`);
    response.setHeader("Cache-Control", "no-store");
    response.send(preview.buffer);
  };

  public getProject = async (request: Request, response: Response): Promise<void> => {
    const project = await this.projectService.getProjectOrThrow(String(request.params.projectId));
    const serializedProject = typeof project.toObject === "function" ? project.toObject() : project;

    if (project.projectType !== "faceless_story") {
      sendSuccess(response, serializedProject);
      return;
    }

    const publishInfo = await this.facelessVideoService.getLatestPublishInfo(String(request.params.projectId));
    sendSuccess(response, {
      ...serializedProject,
      publishInfo
    });
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

  public publishProject = async (request: Request, response: Response): Promise<void> => {
    const result = await this.publishService.publishFacelessProjectNow({
      projectId: String(request.params.projectId),
      channelId: request.body.channelId,
      title: request.body.title,
      description: request.body.description ?? "",
      privacyStatus: request.body.privacyStatus
    });
    sendSuccess(response, result, 201);
  };

  private async enqueueFacelessStage(request: Request, response: Response, stage: FacelessStage): Promise<void> {
    const job = await this.facelessVideoService.enqueueStage(String(request.params.projectId), stage);
    sendSuccess(response, job, 202);
  }
}
