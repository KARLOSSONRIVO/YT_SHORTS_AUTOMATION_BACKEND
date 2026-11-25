import { AppError } from "../../common/errors/app-error";
import type { ChannelRepository } from "../repositories/channel.repository";
import type { AutomationRepository } from "../repositories/automation.repository";
import type { ProjectService } from "../services/project/project.service";
import type { ClipQueueService } from "../services/clipQueue/clip-queue.service";
import { ScheduleService } from "./schedule.service";
import type { AutomationMode } from "./automation.types";

interface ClipProjectInput {
  name: string;
  contentType: "CLIP_UPLOAD";
  accountId: string;
  language: string;
  timezone: string;
  uploadTime: string;
  automationMode: AutomationMode;
  automationEnabled: boolean;
}

export class ClipAutomationService {
  private readonly schedules = new ScheduleService();

  constructor(private readonly repository: AutomationRepository, private readonly channels: ChannelRepository,
    private readonly projects: ProjectService, private readonly clips: ClipQueueService) {}

  async validateAccount(userId: string, accountId: string) {
    const channel = await this.channels.findByIdAndUserId(accountId, userId);
    if (!channel) throw new AppError("YouTube account was not found.", 404, "ACCOUNT_NOT_FOUND");
    const needsRefresh = Boolean(channel.tokenExpiryDate && channel.tokenExpiryDate <= new Date() && !channel.refreshToken);
    return { id: channel.id, accountName: channel.title, channelName: channel.title, externalChannelId: channel.externalChannelId,
      status: channel.status, authenticationActive: channel.status === "connected" && Boolean(channel.refreshToken || channel.accessToken) && !needsRefresh, needsRefresh };
  }

  async createProject(userId: string, input: ClipProjectInput) {
    this.assertClipType(input.contentType);
    const account = await this.validateAccount(userId, input.accountId);
    if (!account.authenticationActive) throw new AppError("Reconnect the assigned YouTube account.", 409, "ACCOUNT_CREDENTIALS_INACTIVE");
    const nextRunAt = this.nextRun(input.timezone, input.uploadTime);
    const project = await this.projects.createAutomationProject({ ...input, userId, visualType: "AUTO", nextRunAt });
    await this.repository.logActivity({ projectId: project._id, userId: project.userId, type: "project_created", severity: "info",
      message: "Clip upload queue created." });
    return project;
  }

  async updateProject(userId: string, projectId: string, input: Partial<ClipProjectInput>) {
    const project = await this.ownedProject(userId, projectId);
    this.assertClipType(input.contentType ?? project.contentType);
    // Queued clips retain their assigned account; moving the queue would upload to the wrong channel.
    if (input.accountId && input.accountId !== String(project.accountId))
      throw new AppError("Create a separate clip queue to use another YouTube account.", 409, "CLIP_ACCOUNT_LOCKED");
    const timezone = input.timezone ?? project.timezone!;
    const uploadTime = input.uploadTime ?? project.uploadTime!;
    const nextRunAt = this.nextRun(timezone, uploadTime);
    return this.projects.updateProject(projectId, { ...input, title: input.name ?? project.title,
      nextRunAt, automationStatus: (input.automationEnabled ?? project.automationEnabled) ? "active" : "paused" });
  }

  async setEnabled(userId: string, projectId: string, enabled: boolean) {
    const project = await this.ownedProject(userId, projectId);
    return this.projects.updateProject(projectId, { automationEnabled: enabled, automationStatus: enabled ? "active" : "paused",
      nextRunAt: enabled ? this.nextRun(project.timezone!, project.uploadTime!) : project.nextRunAt });
  }

  async queueNow(userId: string, projectId: string) {
    await this.ownedProject(userId, projectId);
    return this.clips.uploadNextDue(projectId);
  }

  async execute(projectId: string) {
    const project = await this.projects.getProjectOrThrow(projectId);
    this.assertClipType(project.contentType);
    if (!project.automationEnabled) return { skipped: true };
    return this.clips.uploadNextDue(projectId);
  }

  async enqueueDue(now = new Date()) {
    const projects = await this.projects.findDueProjects(now);
    const results: unknown[] = [];
    for (const project of projects) {
      if (project.contentType !== "CLIP_UPLOAD") continue;
      const claimed = project.nextRunAt ? await this.projects.claimDueProject(project.id, project.nextRunAt,
        this.nextRun(project.timezone!, project.uploadTime!, now)) : null;
      if (!claimed) continue;
      try {
        results.push(await this.execute(project.id));
        await this.projects.updateProject(project.id, { automationStatus: "active" });
      } catch (error) {
        await this.recordFailure(project.id, error);
        results.push(error);
      }
    }
    return results;
  }

  async dashboard(userId: string, projectId: string) {
    const project = await this.ownedProject(userId, projectId);
    const [clips, publishedClips, activity, account] = await Promise.all([this.clips.list(userId, projectId),
      this.clips.history(userId, projectId), this.repository.findActivity(projectId),
      this.validateAccount(userId, String(project.accountId))]);
    return { project, account, clips, publishedClips, activity,
      currentJobStatus: clips.find((clip) => clip.status === "uploading")?.status ?? "idle",
      recentErrors: clips.filter((clip) => clip.error).slice(0, 10).map((clip) => ({ clipId: clip.id, message: clip.error, status: clip.status })),
      lastUpload: project.lastUploadAt };
  }

  async activity(userId: string, projectId: string) {
    await this.ownedProject(userId, projectId);
    return this.repository.findActivity(projectId);
  }

  async deleteProjectData(userId: string, projectId: string) {
    await this.projects.getOwnedProjectOrThrow(projectId, userId);
    return this.repository.deleteProjectData(projectId);
  }

  async recordFailure(projectId: string, error: unknown) {
    const project = await this.projects.getProjectOrThrow(projectId);
    await this.projects.updateProject(projectId, { automationStatus: "error" });
    return this.repository.logActivity({ projectId: project._id, userId: project.userId, type: "clip_upload_failed", severity: "error",
      message: error instanceof Error ? error.message : "Clip upload failed." });
  }

  private async ownedProject(userId: string, projectId: string) {
    const project = await this.projects.getOwnedProjectOrThrow(projectId, userId);
    this.assertClipType(project.contentType);
    if (!project.accountId || !project.timezone || !project.uploadTime)
      throw new AppError("Clip queue configuration is incomplete.", 409, "PROJECT_CONFIGURATION_INCOMPLETE");
    return project;
  }

  private assertClipType(contentType: string) {
    if (contentType !== "CLIP_UPLOAD") throw new AppError("Only clipping projects are supported.", 409, "INVALID_PROJECT_TYPE");
  }

  private nextRun(timezone: string, uploadTime: string, after = new Date()) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); }
    catch { throw new AppError("Timezone is invalid.", 422, "INVALID_TIMEZONE"); }
    return this.schedules.nextRun(timezone, uploadTime, [0, 1, 2, 3, 4, 5, 6], after);
  }
}
