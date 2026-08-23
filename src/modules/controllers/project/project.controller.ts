import type { Request, Response } from "express";
import { AppError } from "../../../common/errors/app-error";
import { getAuthenticatedUser } from "../../../common/middlewares/require-auth.middleware";
import { sendSuccess } from "../../../common/utils/api-response";
import type { AutomationService } from "../../automation/automation.service";
import type { ProjectCleanupService } from "../../services/project/project-cleanup.service";
import type { ProjectService } from "../../services/project/project.service";
import type { RedditService } from "../../services/reddit/reddit.service";
import type { ClipQueueService } from "../../services/clipQueue/clip-queue.service";
import type { NicheConfigService } from "../../automation/niche-config.service";

export class ProjectController {
  constructor(private readonly projectService: ProjectService, private readonly automation: AutomationService,
    private readonly cleanup: ProjectCleanupService, private readonly niches?: NicheConfigService,
    private readonly reddit?: RedditService, private readonly clipQueue?: ClipQueueService) {}

  listNiches = async (_request: Request, response: Response) => sendSuccess(response, await this.automation.listNiches());
  getNiche = async (request: Request, response: Response) => sendSuccess(response,
    await this.niches?.getPersistentNicheOrThrow(String(request.params.nicheId)));
  seedNiches = async (_request: Request, response: Response) => sendSuccess(response, await this.automation.seedNiches());
  createNiche = async (request: Request, response: Response) => sendSuccess(response, await this.niches?.createNiche(request.body), 201);
  updateNiche = async (request: Request, response: Response) => sendSuccess(response,
    await this.niches?.updateNiche(String(request.params.nicheId), request.body));
  setNicheActive = async (request: Request, response: Response) => sendSuccess(response,
    await this.niches?.setNicheActive(String(request.params.nicheId), Boolean(request.body.active)));
  listVoices = async (_request: Request, response: Response) => sendSuccess(response, this.automation.listVoices());
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
  stories = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.stories(getAuthenticatedUser(request).id, String(request.params.projectId)));
  rejected = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.rejected(getAuthenticatedUser(request).id, String(request.params.projectId)));
  activity = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.activity(getAuthenticatedUser(request).id, String(request.params.projectId)));
  pause = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.setEnabled(getAuthenticatedUser(request).id, String(request.params.projectId), false));
  resume = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.setEnabled(getAuthenticatedUser(request).id, String(request.params.projectId), true));
  generateNow = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.queueNow(getAuthenticatedUser(request).id, String(request.params.projectId)), 202);
  approveStory = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.approve(getAuthenticatedUser(request).id, String(request.params.projectId), String(request.params.storyId)));
  uploadStoryNow = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.uploadNow(getAuthenticatedUser(request).id, String(request.params.projectId), String(request.params.storyId)), 202);
  rejectStory = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.reject(getAuthenticatedUser(request).id, String(request.params.projectId), String(request.params.storyId)));
  retryGeneration = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.retryGeneration(getAuthenticatedUser(request).id, String(request.params.projectId), String(request.params.storyId)), 202);
  retryUpload = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.retryUpload(getAuthenticatedUser(request).id, String(request.params.projectId), String(request.params.storyId)), 202);
  redditApproved = async (_request: Request, response: Response) => sendSuccess(response, this.reddit?.approvedSubreddits() ?? []);
  redditTest = async (_request: Request, response: Response) => sendSuccess(response, await this.reddit?.testConnection());
  redditValidate = async (request: Request, response: Response) => sendSuccess(response, await this.reddit?.validateSubreddit(String(request.body.subreddit)));
  redditPreview = async (request: Request, response: Response) => {
    await this.projectService.getOwnedProjectOrThrow(String(request.params.projectId), getAuthenticatedUser(request).id);
    sendSuccess(response, await this.reddit?.preview(String(request.params.projectId)));
  };
  redditHistory = async (request: Request, response: Response) => {
    await this.projectService.getOwnedProjectOrThrow(String(request.params.projectId), getAuthenticatedUser(request).id);
    sendSuccess(response, await this.reddit?.history(String(request.params.projectId)));
  };
  redditFetch = async (request: Request, response: Response) => sendSuccess(response,
    await this.automation.queueNow(getAuthenticatedUser(request).id, String(request.params.projectId)), 202);
  redditReject = async (request: Request, response: Response) => {
    const projectId=String(request.params.projectId);
    await this.projectService.getOwnedProjectOrThrow(projectId, getAuthenticatedUser(request).id);
    sendSuccess(response, await this.reddit?.reject(projectId, String(request.params.sourceId), String(request.body.reason)));
  };
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
