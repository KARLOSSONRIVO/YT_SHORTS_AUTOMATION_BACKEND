import type { Request, Response } from "express";
import { AppError } from "../../../common/errors/app-error";
import { getAuthenticatedUser } from "../../../common/middlewares/require-auth.middleware";
import { sendSuccess } from "../../../common/utils/api-response";
import type { ClipAutomationService } from "../../automation/clip-automation.service";
import type { ProjectCleanupService } from "../../services/project/project-cleanup.service";
import type { ProjectService } from "../../services/project/project.service";
import type { ClipQueueService } from "../../services/clipQueue/clip-queue.service";

export class ProjectController {
  constructor(private readonly projectService: ProjectService, private readonly automation: ClipAutomationService,
    private readonly cleanup: ProjectCleanupService, private readonly clipQueue: ClipQueueService) {}

  validateAccount = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.validateAccount(getAuthenticatedUser(request).id, String(request.params.accountId)));
  createProject = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.createProject(getAuthenticatedUser(request).id, request.body), 201);
  updateProject = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.updateProject(getAuthenticatedUser(request).id, String(request.params.projectId), request.body));
  listProjects = async (request: Request, response: Response) => sendSuccess(response,
    await this.projectService.listProjects(getAuthenticatedUser(request).id));
  getProject = async (request: Request, response: Response) => sendSuccess(response,
    await this.projectService.getOwnedProjectOrThrow(String(request.params.projectId), getAuthenticatedUser(request).id));
  dashboard = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.dashboard(getAuthenticatedUser(request).id, String(request.params.projectId)));
  activity = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.activity(getAuthenticatedUser(request).id, String(request.params.projectId)));
  pause = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.setEnabled(getAuthenticatedUser(request).id, String(request.params.projectId), false));
  resume = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.setEnabled(getAuthenticatedUser(request).id, String(request.params.projectId), true));
  uploadNextClip = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.queueNow(getAuthenticatedUser(request).id, String(request.params.projectId)), 202);
  addClip = async (request: Request, response: Response) => {
    const files = request.files as Record<string, Express.Multer.File[]> | undefined;
    const video = files?.video?.[0];
    if (!video) throw new AppError("A video file is required.", 400, "FILE_REQUIRED");
    sendSuccess(response, await this.clipQueue?.add({ ...request.body, scheduledAt: request.body.scheduledAt ? new Date(request.body.scheduledAt) : undefined,
      userId: getAuthenticatedUser(request).id, projectId: String(request.params.projectId), file: video,
      thumbnail: files?.thumbnail?.[0], subtitles: files?.subtitles?.[0] }), 201);
  };
  clips = async (request: Request, response: Response) => sendSuccess(response,
    await this.clipQueue?.list(getAuthenticatedUser(request).id, String(request.params.projectId)));
  replaceClip = async (request: Request, response: Response) => {
    const files = request.files as Record<string, Express.Multer.File[]> | undefined; const video = files?.video?.[0];
    if (!video) throw new AppError("A replacement video is required.", 400, "FILE_REQUIRED");
    sendSuccess(response, await this.clipQueue?.replace(getAuthenticatedUser(request).id,
      String(request.params.projectId), String(request.params.clipId), video));
  };
  clipHistory = async (request: Request, response: Response) => sendSuccess(response,
    await this.clipQueue?.history(getAuthenticatedUser(request).id, String(request.params.projectId)));
  reorderClips = async (request: Request, response: Response) => sendSuccess(response,
    await this.clipQueue?.reorder(getAuthenticatedUser(request).id, String(request.params.projectId), request.body.clipIds));
  scheduleClip = async (request: Request, response: Response) => sendSuccess(response,
    await this.clipQueue?.schedule(getAuthenticatedUser(request).id, String(request.params.projectId), String(request.params.clipId), new Date(request.body.scheduledAt)));
  removeClip = async (request: Request, response: Response) => sendSuccess(response,
    await this.clipQueue?.remove(getAuthenticatedUser(request).id, String(request.params.projectId), String(request.params.clipId)));
  uploadClipNow = async (request: Request, response: Response) => sendSuccess(response,
    await this.clipQueue?.uploadNow(getAuthenticatedUser(request).id, String(request.params.projectId), String(request.params.clipId)), 202);
  retryClip = async (request: Request, response: Response) => sendSuccess(response,
    await this.clipQueue?.retry(getAuthenticatedUser(request).id, String(request.params.projectId), String(request.params.clipId)), 202);
  deleteProject = async (request: Request, response: Response) => {
    const projectId = String(request.params.projectId); const userId = getAuthenticatedUser(request).id;
    await this.projectService.getOwnedProjectOrThrow(projectId, userId);
    const children = await this.projectService.listInternalStories(projectId);
    for (const child of children) await this.cleanup.deleteProject(child.id);
    await this.automation.deleteProjectData(userId, projectId);
    sendSuccess(response, await this.cleanup.deleteProject(projectId));
  };
}
