import { AppError } from "../../common/errors/app-error";
import type { ProjectDocument } from "../models/project.model";
import type { ContentHistory } from "../models/content-history.model";
import type { ChannelRepository } from "../repositories/channel.repository";
import type { FacelessVideoRepository } from "../repositories/faceless-video.repository";
import type { AutomationRepository } from "../repositories/automation.repository";
import type { FacelessVideoService } from "../services/facelessVideo/faceless-video.service";
import type { ProjectService } from "../services/project/project.service";
import type { PublishService } from "../services/publish/publish.service";
import type { QueueService } from "../services/queue/queue.service";
import { DuplicateDetector, normalizeText } from "./duplicate-detector";
import { NicheConfigService } from "./niche-config.service";
import { PlatformMetadataService } from "./metadata.service";
import { QualityControlService } from "./quality-control.service";
import { ScheduleService } from "./schedule.service";
import { StoryFormatSelector } from "./story-format-selector";
import { TopicResearchService } from "./topic-research.service";
import { TopicRotationService } from "./topic-rotation.service";
import { VoiceSelector } from "./voice-selector";
import { MediaInspectionService } from "./media-inspection.service";
import { isQueuedWorkflowFailure, isRateLimitFailure, isTemporaryFailure, retryDelayMs } from "./retry-policy";
import type { AutomationRunCoordinator } from "./automation-run-coordinator";
import type { AutomationMode, StoryFormat, TopicCandidate } from "./automation.types";
import type { ContentType, VisualType } from "./automation.types";
import type { RedditService } from "../services/reddit/reddit.service";
import type { ClipQueueService } from "../services/clipQueue/clip-queue.service";

export interface CreateAutomationProjectInput {
  name: string;
  contentType: ContentType;
  nicheId?: string;
  accountId: string;
  language: string;
  timezone: string;
  uploadTime: string;
  visualType: VisualType;
  allowedNarrativeFormats?: StoryFormat[];
  redditConfig?: {
    sourceMode: "ONE_SUBREDDIT" | "MULTIPLE_SUBREDDITS" | "AUTO"; subreddits: string[];
    sortMethod: "NEW" | "HOT" | "TOP_TODAY" | "TOP_WEEK" | "RISING" | "BEST_ELIGIBLE";
    minimumScore: number; minimumComments: number; minimumBodyLength: number; allowNSFW: boolean;
    includeComments: boolean; excludeLocked: boolean; contentFilters: string[];
    attributionMode: "link" | "subreddit" | "none"; allowCrossAccountReuse: boolean;
  };
  automationMode: AutomationMode;
  automationEnabled: boolean;
}

export const workflowIdempotencyKey = (projectId: string, scheduledDate: string, workflowType: "generation" | "upload") =>
  `${projectId}:${scheduledDate}:${workflowType}`;
export const projectDailyIdempotencyKey = (projectId: string, scheduledDate: string, contentType: ContentType) =>
  projectId + ":" + scheduledDate + ":" + (contentType === "REDDIT_STORY" ? "REDDIT_FETCH" : contentType === "CLIP_UPLOAD" ? "CLIP_UPLOAD" : "FACELESS_GENERATION");
export const bullmqJobId = (idempotencyKey: string) => idempotencyKey.replaceAll(":", "_");
export const automationRetryOptions = () => ({ attempts: 1000, backoff: { type: "provider-rate-limit" as const } });

export class AutomationService {
  private static readonly GENERATION_LEAD_MINUTES = 180;
  private static readonly ACTIVE_DAYS = [0, 1, 2, 3, 4, 5, 6];
  private readonly duplicate = new DuplicateDetector();
  private readonly rotation = new TopicRotationService();
  private readonly formats = new StoryFormatSelector();
  private readonly voices = new VoiceSelector();
  private readonly schedules = new ScheduleService();
  private readonly metadata = new PlatformMetadataService();
  private readonly qc = new QualityControlService();

  constructor(private readonly repository: AutomationRepository, private readonly config: NicheConfigService,
    private readonly research: TopicResearchService, private readonly channels: ChannelRepository,
    private readonly faceless: FacelessVideoService, private readonly projects: ProjectService,
    private readonly assets: FacelessVideoRepository, private readonly publisher: PublishService,
    private readonly queues: QueueService, private readonly mediaInspection: MediaInspectionService,
    private readonly reddit?: RedditService, private readonly clipQueue?: ClipQueueService,
    private readonly coordinator?: AutomationRunCoordinator) {}

  public async listNiches() { return { defaults: this.config.getDefaults(), niches: await this.config.listActiveNiches() }; }
  public seedNiches() { return this.config.seedDefaults(); }
  public listVoices() { return this.config.listVoices(); }

  public async validateAccount(userId: string, accountId: string) {
    const channel = await this.channels.findByIdAndUserId(accountId, userId);
    if (!channel) throw new AppError("YouTube account was not found.", 404, "ACCOUNT_NOT_FOUND");
    const hasCredentials = Boolean(channel.refreshToken || channel.accessToken);
    const needsRefresh = Boolean(channel.tokenExpiryDate && channel.tokenExpiryDate <= new Date() && !channel.refreshToken);
    return { id: channel.id, accountName: channel.title, channelName: channel.title, externalChannelId: channel.externalChannelId,
      status: channel.status, authenticationActive: channel.status === "connected" && hasCredentials && !needsRefresh, needsRefresh };
  }

  private async enforceChannelNicheLock(userId: string, channelId: string, nicheId: string) {
    const channel = await this.channels.findByIdAndUserId(channelId, userId);
    if (!channel) throw new AppError("YouTube account was not found.", 404, "ACCOUNT_NOT_FOUND");
    if (channel.nicheLockExempt) return;
    const claimed = await this.channels.designateNicheIfFreeOrMatching(channelId, nicheId);
    if (!claimed) throw new AppError("This YouTube channel is already dedicated to a different niche. Each channel can host only one faceless niche — pick another channel.",
      409, "CHANNEL_NICHE_LOCKED", { channelId, lockedNiche: channel.nicheId, requestedNiche: nicheId });
  }

  public async createProject(userId: string, input: CreateAutomationProjectInput) {
    if (input.contentType === "FACELESS_NICHE" && !input.nicheId)
      throw new AppError("Select an active niche profile.", 422, "NICHE_REQUIRED");
    if (input.contentType === "FACELESS_NICHE") await this.config.getPersistentNicheOrThrow(input.nicheId!);
    if (input.contentType === "REDDIT_STORY" && (!this.reddit || !input.redditConfig))
      throw new AppError("Reddit configuration is required.", 422, "REDDIT_CONFIG_REQUIRED");
    this.validateTimezone(input.timezone);
    const account = await this.validateAccount(userId, input.accountId);
    if (!account.authenticationActive) throw new AppError("Assigned account credentials are inactive or need refresh.", 409, "ACCOUNT_CREDENTIALS_INACTIVE", account);
    if (input.contentType === "FACELESS_NICHE") await this.enforceChannelNicheLock(userId, input.accountId, input.nicheId!);
    const nextRunAt = this.nextProjectRun(input.contentType, input.timezone, input.uploadTime);
    const project = await this.projects.createAutomationProject({ ...input, userId, nextRunAt });
    if (input.contentType === "REDDIT_STORY" && input.redditConfig) await this.reddit!.saveConfig(project.id, input.redditConfig);
    await this.repository.logActivity({ projectId: project._id, userId: project.userId, type: "project_created", severity: "info",
      message: input.automationEnabled ? "Project created and daily automation scheduled." : "Project created with daily automation paused.",
      metadata: { contentType: input.contentType, nicheId: input.nicheId, accountId: input.accountId, nextRunAt: input.automationEnabled ? nextRunAt : undefined } });
    return project;
  }

  public async updateProject(userId: string, projectId: string, input: Partial<CreateAutomationProjectInput>) {
    const project = await this.ownedProject(userId, projectId);
    const contentType = input.contentType ?? project.contentType;
    const nicheId = input.nicheId ?? project.nicheId;
    if (contentType === "FACELESS_NICHE" && nicheId) await this.config.getPersistentNicheOrThrow(nicheId);
    const timezone = input.timezone ?? project.timezone!;
    const uploadTime = input.uploadTime ?? project.uploadTime!;
    this.validateTimezone(timezone);
    if (input.accountId) {
      const account = await this.validateAccount(userId, input.accountId);
      if (!account.authenticationActive) throw new AppError("Assigned account credentials are inactive or need refresh.", 409, "ACCOUNT_CREDENTIALS_INACTIVE", account);
    }
    const effectiveAccountId = input.accountId ?? (project.accountId ? String(project.accountId) : undefined);
    if (contentType === "FACELESS_NICHE" && nicheId && effectiveAccountId) await this.enforceChannelNicheLock(userId, effectiveAccountId, nicheId);
    if (contentType === "REDDIT_STORY" && input.redditConfig && this.reddit) await this.reddit.saveConfig(projectId, input.redditConfig);
    return this.projects.updateProject(projectId, { ...input, title: input.name, name: input.name, durationSeconds: 60, targetDurationSeconds: 60,
      allowedStoryFormats: input.allowedNarrativeFormats,
      nextRunAt: (input.automationEnabled ?? project.automationEnabled) ? this.nextProjectRun(contentType, timezone, uploadTime) : project.nextRunAt,
      automationStatus: (input.automationEnabled ?? project.automationEnabled) ? "active" : "paused" });
  }

  public async setEnabled(userId: string, projectId: string, enabled: boolean) {
    const project = await this.ownedProject(userId, projectId);
    const updated = await this.projects.updateProject(projectId, { automationEnabled: enabled, automationStatus: enabled ? "active" : "paused",
      nextRunAt: enabled ? this.nextProjectRun(project.contentType, project.timezone!, project.uploadTime!) : project.nextRunAt });
    await this.repository.logActivity({ projectId: project._id, userId: project.userId, type: enabled ? "automation_resumed" : "automation_paused",
      severity: "info", message: enabled ? "Daily automation resumed." : "Daily automation paused." });
    return updated;
  }

  public async queueNow(userId: string, projectId: string) {
    const project = await this.ownedProject(userId, projectId);
    if (project.contentType === "CLIP_UPLOAD") {
      if (!this.clipQueue) throw new AppError("Clip queue is unavailable.", 503, "CLIP_QUEUE_UNAVAILABLE");
      return this.clipQueue.uploadNextDue(projectId);
    }
    const date = this.schedules.localDateKey(project.timezone!);
    const generationIdempotencyKey = projectDailyIdempotencyKey(projectId, date, project.contentType);
    const existing = await this.repository.findByGenerationKey(generationIdempotencyKey);
    if (existing) throw new AppError("This project already has a generation job for today.", 409, "ONE_STORY_PER_DAY");
    const job = await this.queues.addAutomationJob({ projectId, scheduledDate: date, trigger: "manual", idempotencyKey: generationIdempotencyKey },
      { jobId: bullmqJobId(generationIdempotencyKey), ...automationRetryOptions() });
    await this.repository.logActivity({ projectId: project._id, userId: project.userId, type: "generation_queued", severity: "info", message: "Generate Now queued for today." });
    return { jobId: job.id, status: "queued", generationIdempotencyKey };
  }

  public async execute(projectId: string, scheduledDate?: string, trigger: "manual" | "scheduled" = "scheduled", runId?: string) {
    const project = await this.projects.getProjectOrThrow(projectId);
    if (project.contentType === "CLIP_UPLOAD") {
      if (!this.clipQueue) throw new AppError("Clip queue is unavailable.", 503, "CLIP_QUEUE_UNAVAILABLE");
      return this.clipQueue.uploadNextDue(projectId);
    }
    this.assertAutomationProject(project);
    const date = scheduledDate ?? this.schedules.localDateKey(project.timezone!);
    const generationIdempotencyKey = projectDailyIdempotencyKey(projectId, date, project.contentType);
    const automationRunId = runId ?? generationIdempotencyKey;
    const coordinator = this.coordinator;
    const startHeartbeat = () => coordinator
      ? setInterval(() => { void coordinator.touch(projectId, automationRunId).catch(() => undefined); }, 30_000)
      : undefined;
    const existing = await this.repository.findByGenerationKey(generationIdempotencyKey);
    if (existing) {
      const canResume = existing.status === "rendering"
        && existing.renderProjectId
        && existing.metadata?.automationRunId === automationRunId;
      if (!canResume) return { contentIds: [existing.id], projectId, duplicateJob: true };

      await this.coordinator?.begin(projectId, automationRunId);
      const heartbeatTimer = startHeartbeat();
      try {
        await this.projects.updateProject(projectId, { automationStatus: "running", lastRunAt: new Date() });
        const resumedJob = await this.faceless.startAutomation(String(existing.renderProjectId));
        return { contentIds: [existing.id], projectId, renderProjectId: String(existing.renderProjectId), resumedJob: true, jobId: resumedJob?.id };
      } catch (error) {
        if (!isRateLimitFailure(error)) await this.coordinator?.finish(projectId, automationRunId);
        throw error;
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
      }
    }
    await this.coordinator?.begin(projectId, automationRunId);
    const heartbeatTimer = startHeartbeat();
    try {
    const channel = await this.channels.findById(String(project.accountId));
    if (!channel || channel.status !== "connected" || (!channel.refreshToken && !channel.accessToken)) throw new AppError("Assigned account credentials are inactive.", 409, "ACCOUNT_CREDENTIALS_INACTIVE");
    const profile = await this.config.getPersistentNicheOrThrow(project.contentType === "REDDIT_STORY" ? "true_stories" : project.nicheId!);
    await this.projects.updateProject(projectId, { automationStatus: "running", lastRunAt: new Date() });
    const historyNicheId = project.contentType === "REDDIT_STORY" ? "reddit:" + projectId : project.nicheId!;
    const history = await this.repository.findComparisonHistory(historyNicheId, String(project.accountId));
    const redditSelection = project.contentType === "REDDIT_STORY" ? await this.reddit?.select(projectId, String(project.accountId)) : undefined;
    if (project.contentType === "REDDIT_STORY" && !redditSelection)
      throw new AppError("Reddit automation is unavailable.", 503, "REDDIT_NOT_CONFIGURED");
    const checkpoint = await this.repository.findCheckpoint?.(projectId, date);
    let candidates = redditSelection ? [redditSelection.candidate] : checkpoint?.researchCandidates;
    const generateCandidates = async (): Promise<TopicCandidate[]> => {
      const generated = await this.research.generate({ profile, language: project.language!, region: profile.region,
        recentTopics: history.map((item) => item.topic), recentEntities: history.flatMap((item) => item.importantEntities) });
      candidates = generated;
      await this.repository.saveResearchCheckpoint?.(projectId, date, generated);
      return generated;
    };
    if (!candidates?.length) {
      await generateCandidates();
    }
    let selected: TopicCandidate;
    try {
      selected = await this.chooseCandidate(project, candidates ?? [], history);
    } catch (error) {
      if (redditSelection && error instanceof AppError && error.code === "NO_UNIQUE_TOPICS") {
        const details = error.details as { reasons?: unknown } | undefined;
        const reasons = Array.isArray(details?.reasons) ? details.reasons.filter((reason): reason is string => typeof reason === "string") : [];
        await redditSelection.record.updateOne({ status: "rejected", rejectionReason: reasons.length ? [...new Set(reasons)].join("; ") : error.message });
        throw error;
      }
      if (!redditSelection && error instanceof AppError && error.code === "NO_UNIQUE_TOPICS") {
        await this.repository.clearCheckpoint?.(projectId, date);
        const refreshedCandidates = await generateCandidates();
        selected = await this.chooseCandidate(project, refreshedCandidates, history);
      } else {
        throw error;
      }
    }
    const storyFormat = this.formats.select(profile, selected, { mode: "auto_select", allowed: project.allowedStoryFormats });
    const voice = this.voices.select(profile, this.config.listVoices(), storyFormat, project.language!);
    if (redditSelection) await this.repository.logActivity({ projectId: project._id, userId: project.userId, type: "reddit_source_selected", severity: "info",
      message: `Selected Reddit source from r/${redditSelection.post.subreddit}: ${redditSelection.post.title}`,
      metadata: { redditSourceId: redditSelection.record.id, subreddit: redditSelection.post.subreddit, title: redditSelection.post.title } });
    const renderProject = await this.faceless.createGeneratedStoryProject({ parentProjectId: projectId, userId: String(project.userId), topic: selected.topic,
      title: selected.title, description: selected.summary, platforms: ["youtube"], targetDurationSeconds: project.durationSeconds ?? 60,
      stylePreset: profile.visualStyle, scriptFramework: project.contentType === "REDDIT_STORY" ? "reddit_story" : this.formats.framework(storyFormat),
      facelessRenderMode: project.contentType === "REDDIT_STORY"
        ? "background_video"
        : this.resolveVisualType(project.visualType ?? "AUTO", selected, profile.visualPreferences),
      voice: voice.selected.id, tone: profile.tones.join(", "), audience: profile.targetAudience.join(", "), language: project.language,
      contentType: project.contentType,
      storyFormat, speakingRate: voice.selected.speed, fallbackVoice: voice.fallback?.id });
    const scheduledUploadTime = trigger === "manual"
      ? new Date()
      : this.schedules.nextRun(project.timezone!, project.uploadTime!, AutomationService.ACTIVE_DAYS, new Date(Date.now() - 60_000));
    const historyInput: ContentHistory = { userId: project.userId, projectId: project._id, renderProjectId: renderProject._id,
      nicheId: historyNicheId, accountId: project.accountId!, topic: selected.topic, normalizedTopic: normalizeText(selected.topic), title: selected.title,
      projectTitle: selected.title, description: selected.summary, summary: selected.summary, importantEntities: selected.importantEntities,
      dates: selected.dates, events: selected.events, keywords: selected.keywords, sourceLinks: selected.sourceLinks, storyAngle: selected.storyAngle,
      storyFormat, tone: profile.tones.join(", "), targetAudience: profile.targetAudience, visualStyle: profile.visualStyle,
      voiceId: voice.selected.id, fallbackVoiceId: voice.fallback?.id, language: project.language!, region: profile.region,
      targetDurationSeconds: project.durationSeconds ?? 60, contentEmbedding: selected.embedding ?? this.duplicate.embedding(`${selected.topic} ${selected.summary} ${selected.storyAngle}`),
      status: "rendering", scheduledUploadTime, platform: "youtube", generationIdempotencyKey,
      uploadIdempotencyKey: workflowIdempotencyKey(projectId, date, "upload"), uploadAttempts: 0, generationAttempts: 1,
      metadata: { candidate: selected, contentRestrictions: profile.contentRestrictions, hashtagCategories: profile.hashtagCategories,
        researchRequirements: profile.researchRequirements,
        visualStrategy: project.contentType === "REDDIT_STORY" ? "background_video" : project.visualType === "ANIMATED" ? "ai_animated" : "ai_generated",
        contentType: project.contentType, redditSourceId: redditSelection?.record.id, assignedAccount: channel.title, automationRunId } };
    const historyResult = typeof this.repository.createHistoryIdempotent === "function"
      ? await this.repository.createHistoryIdempotent(historyInput)
      : { content: await this.repository.createHistory(historyInput), created: true };
    const content = historyResult.content;
    if (!historyResult.created) {
      return { contentIds: [content.id], projectId, duplicateJob: true };
    }
    if (redditSelection) await redditSelection.record.updateOne({ storyId: content._id, status: "transformed", generatedTitle: selected.title, summary: selected.summary });
    await this.faceless.startAutomation(renderProject.id);
    await this.repository.logActivity({ projectId: project._id, userId: project.userId, type: "generation_started", severity: "info",
      message: `Started a unique ${storyFormat.replaceAll("_", " ")} story: ${selected.title}`, metadata: { contentId: content.id, renderProjectId: renderProject.id } });
    return { contentIds: [content.id], projectId, renderProjectId: renderProject.id, topic: selected.topic, storyFormat, voiceId: voice.selected.id };
    } catch (error) {
      if (!isRateLimitFailure(error)) await this.coordinator?.finish(projectId, automationRunId);
      throw error;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }

  public async dashboard(userId: string, projectId: string) {
    const project = await this.ownedProject(userId, projectId);
    if (project.contentType === "CLIP_UPLOAD" && this.clipQueue) {
      const [clips, publishedClips, activity, account] = await Promise.all([
        this.clipQueue.list(userId, projectId), this.clipQueue.history(userId, projectId),
        this.repository.findActivity(projectId), this.validateAccount(userId, String(project.accountId))
      ]);
      return { project, account, clips, publishedClips, stories: [], rejectedTopics: [], activity,
        currentJobStatus: clips.find((clip) => clip.status === "uploading")?.status ?? "idle",
        recentErrors: clips.filter((clip) => clip.error).slice(0, 10).map((clip) => ({ clipId: clip.id, message: clip.error, status: clip.status })),
        lastUpload: project.lastUploadAt };
    }
    const [stories, rejected, activity, account] = await Promise.all([this.repository.findHistoryForProject(projectId), this.repository.findRejected(projectId),
      this.repository.findActivity(projectId), this.validateAccount(userId, String(project.accountId))]);
    const storiesWithPreviews = await Promise.all(stories.map(async (story) => {
      const finalVideo = story.renderProjectId ? await this.assets.findLatestAssetByType(String(story.renderProjectId), "final_video") : null;
      return { ...story.toObject(), createdAt: (story as unknown as { createdAt: Date }).createdAt,
        lastError: ["failed", "rejected"].includes(story.status) ? story.lastError : undefined,
        metadata: { ...(story.metadata ?? {}), finalVideoUrl: finalVideo?.url } };
    }));
    const todayKey = this.schedules.localDateKey(project.timezone!);
    const todaysStories = storiesWithPreviews.filter((story) => this.schedules.localDateKey(project.timezone!, story.createdAt) === todayKey);
    const redditSources = project.contentType === "REDDIT_STORY" && this.reddit ? await this.reddit.history(projectId) : [];
    return { project, account, stories: todaysStories, rejectedTopics: rejected, redditSources, activity,
      currentJobStatus: todaysStories.find((story) => !["uploaded", "draft", "failed", "rejected"].includes(story.status))?.status ?? "idle",
      recentErrors: stories.filter((story) => story.status === "failed" && story.lastError).slice(0, 10).map((story) => ({ storyId: story.id, message: story.lastError, status: story.status })),
      lastSuccessfulGeneration: project.lastSuccessfulGenerationAt, lastUpload: project.lastUploadAt };
  }

  public async stories(userId: string, projectId: string) { await this.ownedProject(userId, projectId); return this.repository.findHistoryForProject(projectId); }
  public async rejected(userId: string, projectId: string) { await this.ownedProject(userId, projectId); return this.repository.findRejected(projectId); }
  public async activity(userId: string, projectId: string) { await this.ownedProject(userId, projectId); return this.repository.findActivity(projectId); }
  public async deleteProjectData(userId: string, projectId: string) { await this.ownedProject(userId, projectId); return this.repository.deleteProjectData(projectId); }

  public async approve(userId: string, projectId: string, contentId: string) {
    await this.ownedProject(userId, projectId);
    const content = await this.ownedContent(projectId, contentId);
    if (content.status !== "awaiting_approval") throw new AppError("Story is not waiting for approval.", 409, "CONTENT_NOT_AWAITING_APPROVAL");
    return this.upload(content.id);
  }

  public async uploadNow(userId: string, projectId: string, contentId: string) {
    await this.ownedProject(userId, projectId);
    const content = await this.ownedContent(projectId, contentId);
    if (content.status !== "scheduled" || !content.scheduledUploadTime)
      throw new AppError("Only scheduled stories can be uploaded now.", 409, "STORY_NOT_SCHEDULED");
    return this.upload(content.id);
  }

  public async reject(userId: string, projectId: string, contentId: string) {
    const project = await this.ownedProject(userId, projectId); await this.ownedContent(projectId, contentId);
    const content = await this.repository.updateHistory(contentId, { status: "rejected", lastError: "Rejected by user before upload." });
    await this.repository.logActivity({ projectId: project._id, userId: project.userId, type: "story_rejected", severity: "warning", message: "Story rejected before upload.", metadata: { contentId } });
    return content;
  }

  public async retryGeneration(userId: string, projectId: string, contentId: string) {
    await this.ownedProject(userId, projectId); const content = await this.ownedContent(projectId, contentId);
    if (content.status !== "failed" || !content.renderProjectId) throw new AppError("Only failed render jobs can be retried.", 409, "GENERATION_NOT_RETRYABLE");
    await this.repository.updateHistory(contentId, { status: "rendering", generationAttempts: content.generationAttempts + 1, nextRetryAt: undefined, lastError: undefined });
    const renderProject = await this.projects.getProjectOrThrow(String(content.renderProjectId));
    const resumableStages = new Set(["script", "audio", "subtitles", "scenes", "animations", "ambience", "render"]);
    const failedStage = resumableStages.has(renderProject.workflowStage) ? renderProject.workflowStage : "script";
    return this.faceless.enqueueStage(String(content.renderProjectId), failedStage as Parameters<FacelessVideoService["enqueueStage"]>[1], { autoRun: true });
  }

  public async retryUpload(userId: string, projectId: string, contentId: string) {
    await this.ownedProject(userId, projectId); const content = await this.ownedContent(projectId, contentId);
    if (content.status !== "failed" || content.uploadAttempts === 0) throw new AppError("Only failed uploads can be retried.", 409, "UPLOAD_NOT_RETRYABLE");
    await this.repository.updateHistory(contentId, { status: "scheduled", nextRetryAt: undefined, lastError: undefined });
    return this.upload(contentId);
  }

  public async reconcile(limit = 50) {
    const pending = await this.repository.findPendingFinalization(limit); const results: unknown[] = [];
    for (const content of pending) {
      try {
      if (!content.renderProjectId) continue;
      const automationRunId = typeof content.metadata?.automationRunId === "string"
        ? content.metadata.automationRunId
        : content.generationIdempotencyKey;
      if (content.status === "scheduled") {
        // Generation is already finished here - this run is only waiting for
        // its upload window. Holding a generation slot while that clock runs is
        // what queued every other project behind a scheduled video, so the slot
        // goes back to the pool and the upload proceeds on its own schedule.
        await this.coordinator?.finish(String(content.projectId), automationRunId);
        if (!content.scheduledUploadTime || content.scheduledUploadTime <= new Date()) {
          try { results.push(await this.upload(content.id)); } catch (error) { results.push(error); }
        }
        continue;
      }
      // Still generating: refresh the slot so it is not reclaimed. A run that
      // stops appearing here (crashed worker, lost job) stops heartbeating and
      // its slot is reclaimed as stale in minutes instead of being held until a
      // long TTL expires.
      await this.coordinator?.touch(String(content.projectId), automationRunId);
      const [rootProject, renderProject, script, finalVideo, render, channel, subtitleAssets] = await Promise.all([
        this.projects.getProjectOrThrow(String(content.projectId)), this.projects.getProjectOrThrow(String(content.renderProjectId)),
        this.assets.findScript(String(content.renderProjectId)), this.assets.findLatestAssetByType(String(content.renderProjectId), "final_video"),
        this.assets.findRender(String(content.renderProjectId)), this.channels.findById(String(content.accountId)),
        this.assets.findAssets(String(content.renderProjectId), { assetType: { $in: ["subtitle_srt", "subtitle_ass"] } })
      ]);
      if (renderProject.status === "failed") {
        results.push(await this.repository.updateHistory(content.id, { status: "failed", lastError: "Faceless rendering failed." }));
        await this.coordinator?.finish(rootProject.id, automationRunId);
        continue;
      }
      if (!script || !finalVideo) {
        const liveStatus = this.storyStatusForRenderStatus(renderProject.status);
        if (liveStatus !== content.status) results.push(await this.repository.updateHistory(content.id, { status: liveStatus }));
        continue;
      }
      const duration = Number(render?.durationSeconds ?? finalVideo.metadata?.durationSeconds ?? content.targetDurationSeconds);
      const complete = await this.repository.updateHistory(content.id, { status: "quality_check", script: script.narration, hook: script.hook,
        projectTitle: renderProject.title, estimatedDurationSeconds: duration, scriptFingerprint: this.duplicate.fingerprint(script.narration),
        metadata: { ...(content.metadata ?? {}), sceneBreakdown: script.scenes, visualPrompts: script.imagePrompts, voiceOverText: script.narration,
          subtitles: "generated and synchronized", backgroundMusicRecommendation: "renderer mood selection", soundEffectRecommendations: [],
          thumbnailText: script.hook, assignedAccount: channel?.title } });
      if (!complete) continue;
      const redditSourceId = complete.metadata?.redditSourceId;
      if (this.reddit && typeof redditSourceId === "string") await this.reddit.completeTransformation(redditSourceId, {
        generatedTitle: renderProject.title, generatedScript: script.narration, summary: complete.summary,
        entities: complete.importantEntities, storyAngle: complete.storyAngle
      });
      const inspection = finalVideo.absolutePath ? await this.mediaInspection.inspect(finalVideo.absolutePath) : undefined;
      const check = this.qc.check({ content: complete, finalVideo: inspection ? { ...inspection, subtitleCount: subtitleAssets.length,
        mediaRightsVerified: complete.metadata?.visualStrategy === "ai_generated" } : undefined,
        accountActive: channel?.status === "connected" && Boolean(channel.refreshToken || channel.accessToken) });
      await this.repository.updateHistory(content.id, { qc: check });
      if (!check.passed) {
        results.push(await this.repository.updateHistory(content.id, { status: "failed", lastError: `Quality control failed: ${check.critical.join("; ")}` }));
        await this.projects.updateProject(rootProject.id, { automationStatus: "error" });
        await this.repository.logActivity({ projectId: rootProject._id, userId: rootProject.userId, type: "quality_control_failed", severity: "error",
          message: `Story failed quality control: ${check.critical.join("; ")}`, metadata: { contentId: content.id } });
        await this.coordinator?.finish(rootProject.id, automationRunId);
        continue;
      }
      const nextStatus = rootProject.automationMode === "draft_only" ? "draft" : rootProject.automationMode === "approval_before_upload" ? "awaiting_approval" : "scheduled";
      results.push(await this.repository.updateHistory(content.id, { status: nextStatus }));
      // Generation is complete for every outcome here - draft, awaiting_approval
      // and scheduled all wait on a human or on the clock, not on render
      // capacity. Release the slot now instead of holding it until upload.
      await this.coordinator?.finish(rootProject.id, automationRunId);
      await this.projects.updateProject(rootProject.id, { lastSuccessfulGenerationAt: new Date(), automationStatus: rootProject.automationEnabled ? "active" : "paused" });
      await this.repository.logActivity({ projectId: rootProject._id, userId: rootProject.userId, type: "generation_completed", severity: "info",
        message: rootProject.automationMode === "approval_before_upload" ? "Story passed generation and is waiting for approval." : "Story passed generation and quality preparation." });
      if (nextStatus === "scheduled" && (!content.scheduledUploadTime || content.scheduledUploadTime <= new Date())) {
        try { results.push(await this.upload(content.id)); } catch (error) { results.push(error); }
      }
      } catch (error) {
        results.push(error);
      }
    }
    return results;
  }

  public async enqueueDue(now = new Date()) {
    const due = await this.projects.findDueProjects(now); const queued: unknown[] = [];
    for (const project of due) {
      const next = this.nextProjectRun(project.contentType, project.timezone!, project.uploadTime!, now);
      const claimed = project.nextRunAt ? await this.projects.claimDueProject(project.id, project.nextRunAt, next) : null;
      if (!claimed) continue;
      const date = this.schedules.localDateKey(project.timezone!, now);
      const idempotencyKey = projectDailyIdempotencyKey(project.id, date, project.contentType);
      queued.push(await this.queues.addAutomationJob({ projectId: project.id, scheduledDate: date, trigger: "scheduled", idempotencyKey },
        { jobId: bullmqJobId(idempotencyKey), ...automationRetryOptions() }));
    }
    return queued;
  }

  private async upload(contentId: string) {
    const content = await this.repository.findHistory(contentId);
    if (!content?.renderProjectId) throw new AppError("Story render is missing.", 409, "CONTENT_RENDER_MISSING");
    const automationRunId = typeof content.metadata?.automationRunId === "string"
      ? content.metadata.automationRunId
      : content.generationIdempotencyKey;
    const [project, channel, finalVideo, subtitleAssets] = await Promise.all([this.projects.getProjectOrThrow(String(content.projectId)),
      this.channels.findById(String(content.accountId)), this.assets.findLatestAssetByType(String(content.renderProjectId), "final_video"),
      this.assets.findAssets(String(content.renderProjectId), { assetType: { $in: ["subtitle_srt", "subtitle_ass"] } })]);
    if (!channel) throw new AppError("Assigned account mapping is missing.", 409, "ACCOUNT_MAPPING_REQUIRED");
    if (await this.repository.countUploadedSince(String(content.accountId), this.schedules.startOfLocalDay(project.timezone!)) >= 1)
      throw new AppError("The account daily upload limit has been reached.", 429, "DAILY_UPLOAD_LIMIT_REACHED");
    const inspection = finalVideo?.absolutePath ? await this.mediaInspection.inspect(finalVideo.absolutePath) : undefined;
    const check = this.qc.check({ content, finalVideo: inspection ? { ...inspection, subtitleCount: subtitleAssets.length, mediaRightsVerified: content.metadata?.visualStrategy === "ai_generated" } : undefined,
      accountActive: channel.status === "connected" && Boolean(channel.refreshToken || channel.accessToken) });
    await this.repository.updateHistory(content.id, { qc: check });
    if (!check.passed) throw new AppError(`Critical quality checks failed: ${check.critical.join("; ")}`, 422, "QUALITY_CONTROL_FAILED", check);
    const claimed = await this.repository.claimUpload(content.id);
    if (!claimed) throw new AppError("Upload was already claimed or completed; duplicate upload blocked.", 409, "DUPLICATE_UPLOAD_BLOCKED");
    const profile = this.config.getNicheOrThrow(content.nicheId.startsWith("reddit:") ? "true_stories" : content.nicheId);
    const candidate = content.metadata?.candidate as TopicCandidate | undefined;
    const meta = this.metadata.build(candidate ?? { topic: content.topic, title: content.title, summary: content.summary, storyAngle: content.storyAngle,
      importantEntities: content.importantEntities, dates: content.dates, events: content.events, keywords: content.keywords, sourceLinks: content.sourceLinks,
      disputedFacts: [], factualConfidence: 1, scores: { curiosity: 1, emotionalImpact: 1, shortFormPotential: 1, nicheRelevance: 1, originality: 1, retentionPotential: 1 } }, profile, "youtube");
    try {
      const result = await this.publisher.publishFacelessProjectNow({ projectId: String(content.renderProjectId), channelId: String(content.accountId),
        title: meta.title, description: meta.description, privacyStatus: "public" });
      await this.projects.updateProject(project.id, { lastUploadAt: new Date() });
      const redditSourceId = content.metadata?.redditSourceId;
      if (this.reddit && typeof redditSourceId === "string") await this.reddit.markUploaded(redditSourceId, result.youtubeVideoId ?? undefined);
      await this.repository.logActivity({ projectId: project._id, userId: project.userId, type: "upload_completed", severity: "info", message: `Published ${meta.title}.`, metadata: { platformVideoId: result.youtubeVideoId } });
      const uploaded = await this.repository.updateHistory(content.id, { status: "uploaded", lastError: undefined, uploadDate: new Date(), platformVideoId: result.youtubeVideoId ?? undefined,
        platformUrl: result.videoUrl, metadata: { ...(content.metadata ?? {}), platformMetadata: meta } });
      await this.repository.clearCheckpoint(project.id, content.generationIdempotencyKey.split(":")[1] ?? "");
      await this.coordinator?.finish(project.id, automationRunId);
      return uploaded;
    } catch (error) {
      const temporary = isTemporaryFailure(error) && content.uploadAttempts < 3;
      await this.repository.updateHistory(content.id, { status: "failed", nextRetryAt: temporary ? new Date(Date.now() + retryDelayMs(content.uploadAttempts + 1)) : undefined,
        lastError: error instanceof Error ? error.message : "Upload failed." });
      throw error;
    }
  }

  private async chooseCandidate(project: ProjectDocument, candidates: TopicCandidate[], history: Awaited<ReturnType<AutomationRepository["findComparisonHistory"]>>) {
    const accepted: TopicCandidate[] = [];
    const rejectionReasons: string[] = [];
    for (const candidate of candidates) {
      const duplicate = this.duplicate.compare(candidate, history, this.config.getDefaults().similarityThreshold);
      const rotation = this.rotation.violations(candidate, history);
      if (duplicate.duplicate || rotation.length) {
        const reasons = [...duplicate.reasons, ...rotation];
        rejectionReasons.push(...reasons);
        await this.repository.createRejected({ userId: project.userId, projectId: project._id, nicheId: project.nicheId ?? "reddit", topic: candidate.topic,
          title: candidate.title, reasons, similarityScore: duplicate.score, matchedContentId: duplicate.matchedHistoryId as never });
      } else accepted.push(candidate);
    }
    if (!accepted.length) throw new AppError("No sufficiently unique topic survived duplicate and rotation checks.", 409, "NO_UNIQUE_TOPICS", { reasons: [...new Set(rejectionReasons)] });
    const weight = (candidate: TopicCandidate) => Object.values(candidate.scores).reduce((sum, score) => sum + score, 0) + candidate.factualConfidence;
    return accepted.sort((a, b) => weight(b) - weight(a))[0];
  }

  private async ownedProject(userId: string, projectId: string) {
    const project = await this.projects.getOwnedProjectOrThrow(projectId, userId); this.assertAutomationProject(project); return project;
  }

  public async recordFailure(projectId: string, error: unknown, runId?: string) {
    const project = await this.projects.getProjectOrThrow(projectId);
    const message = error instanceof Error ? error.message : "Daily story generation failed.";
    if (isQueuedWorkflowFailure(error)) {
      return this.repository.logActivity({ projectId: project._id, userId: project.userId, type: "generation_queued", severity: "info",
        message: "Another story is active. This job remains queued and will start after the active story finishes." });
    }
    if (isRateLimitFailure(error)) {
      return this.repository.logActivity({ projectId: project._id, userId: project.userId, type: "rate_limit_paused", severity: "warning",
        message: `AI provider rate limit reached. The active step is paused and queued for retry: ${message}` });
    }
    await this.projects.updateProject(projectId, { automationStatus: "error" });
    if (runId) await this.coordinator?.finish(projectId, runId);
    return this.repository.logActivity({ projectId: project._id, userId: project.userId, type: "generation_failed", severity: "error", message });
  }

  private async ownedContent(projectId: string, contentId: string) {
    const content = await this.repository.findHistory(contentId);
    if (!content || String(content.projectId) !== projectId) throw new AppError("Story was not found.", 404, "CONTENT_NOT_FOUND");
    return content;
  }

  private assertAutomationProject(project: ProjectDocument) {
    if (project.internalStory || !["FACELESS_NICHE", "REDDIT_STORY", "CLIP_UPLOAD"].includes(project.contentType))
      throw new AppError("Project is not a unified automation project.", 409, "INVALID_PROJECT_TYPE");
    if (project.contentType !== "CLIP_UPLOAD" && (project.projectType !== "faceless_story" || project.facelessSource !== "daily_automation"))
      throw new AppError("Story project is not connected to daily automation.", 409, "INVALID_PROJECT_TYPE");
    if (project.contentType === "FACELESS_NICHE" && !project.nicheId)
      throw new AppError("Project niche configuration is incomplete.", 409, "PROJECT_CONFIGURATION_INCOMPLETE");
    if (!project.accountId || !project.timezone || !project.uploadTime || !project.language)
      throw new AppError("Project automation configuration is incomplete.", 409, "PROJECT_CONFIGURATION_INCOMPLETE");
  }

  private resolveVisualType(visualType: VisualType, candidate: TopicCandidate, preferences: string[]) {
    if (visualType === "IMAGE") return "image_story" as const;
    if (visualType === "ANIMATED") return "animation_story" as const;
    const text = [candidate.topic, candidate.storyAngle, ...preferences].join(" ").toLowerCase();
    return /(motion|animation|map|timeline|process|journey|reenact)/.test(text) ? "animation_story" as const : "image_story" as const;
  }

  private validateTimezone(timezone: string) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); }
    catch { throw new AppError("Timezone is invalid.", 422, "INVALID_TIMEZONE"); }
  }

  private storyStatusForRenderStatus(status: ProjectDocument["status"]): "queued" | "writing" | "generating_voice" | "generating_visuals" | "rendering" {
    if (status === "draft" || status === "queued") return "queued";
    if (status === "writing_script") return "writing";
    if (status === "generating_audio" || status === "generating_subtitles") return "generating_voice";
    if (status === "generating_images" || status === "animating_scenes") return "generating_visuals";
    return "rendering";
  }

  private nextGenerationRun(timezone: string, uploadTime: string, after = new Date()) {
    const searchAfter = new Date(after.getTime() + AutomationService.GENERATION_LEAD_MINUTES * 60_000 + 60_000);
    return new Date(this.schedules.nextRun(timezone, uploadTime, AutomationService.ACTIVE_DAYS, searchAfter).getTime() - AutomationService.GENERATION_LEAD_MINUTES * 60_000);
  }
  private nextProjectRun(contentType: ContentType, timezone: string, uploadTime: string, after = new Date()) {
    return contentType === "CLIP_UPLOAD"
      ? this.schedules.nextRun(timezone, uploadTime, AutomationService.ACTIVE_DAYS, after)
      : this.nextGenerationRun(timezone, uploadTime, after);
  }
}
