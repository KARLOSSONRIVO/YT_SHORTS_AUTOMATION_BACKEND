import fs from "node:fs/promises";
import multer from "multer";
import { createRequireAuth } from "../common/middlewares/require-auth.middleware";
import { env } from "./env";
import { connectToDatabase, disconnectFromDatabase } from "../infrastructure/db/mongoose";
import { FfmpegClient } from "../infrastructure/ffmpeg/ffmpeg.client";
import { PythonWorkerClient } from "../infrastructure/pythonWorker/python-worker.client";
import { closeQueues, createQueues } from "../infrastructure/queue/queues";
import { createRedisConnection } from "../infrastructure/redis/redis.connection";
import { LocalStorageClient } from "../infrastructure/storage/storage.client";
import { YouTubeClient } from "../infrastructure/youtube/youtube.client";
import { AuthController } from "../modules/controllers/auth/auth.controller";
import { ChannelController } from "../modules/controllers/channel/channel.controller";
import { ClipController } from "../modules/controllers/clip/clip.controller";
import { HealthController } from "../modules/controllers/health/health.controller";
import { JobController } from "../modules/controllers/job/job.controller";
import { ProjectController } from "../modules/controllers/project/project.controller";
import { PublishController } from "../modules/controllers/publish/publish.controller";
import { SubtitleController } from "../modules/controllers/subtitle/subtitle.controller";
import { UploadController } from "../modules/controllers/upload/upload.controller";
import { ChannelRepository } from "../modules/repositories/channel.repository";
import { ClipRepository } from "../modules/repositories/clip.repository";
import { FacelessVideoRepository } from "../modules/repositories/faceless-video.repository";
import { JobRepository } from "../modules/repositories/job.repository";
import { ProjectRepository } from "../modules/repositories/project.repository";
import { SourceVideoRepository } from "../modules/repositories/source-video.repository";
import { TranscriptRepository } from "../modules/repositories/transcript.repository";
import { UploadHistoryRepository } from "../modules/repositories/upload-history.repository";
import { UserRepository } from "../modules/repositories/user.repository";
import { AuthService } from "../modules/services/auth/auth.service";
import { AuthTokenService } from "../modules/services/auth/auth-token.service";
import { ChannelService } from "../modules/services/channel/channel.service";
import { ClipService } from "../modules/services/clip/clip.service";
import { FacelessVideoService } from "../modules/services/facelessVideo/faceless-video.service";
import { JobService } from "../modules/services/job/job.service";
import { ProjectService } from "../modules/services/project/project.service";
import { PublishService } from "../modules/services/publish/publish.service";
import { QueueService } from "../modules/services/queue/queue.service";
import { RedditTrendingService } from "../modules/services/redditStory/reddit-trending.service";
import { RenderService } from "../modules/services/render/render.service";
import { SourceVideoService } from "../modules/services/sourceVideo/source-video.service";
import { StorageService } from "../modules/services/storage/storage.service";
import { SubtitleService } from "../modules/services/subtitle/subtitle.service";
import { TranscriptService } from "../modules/services/transcript/transcript.service";
import { UploadService } from "../modules/services/upload/upload.service";
import { WorkflowOrchestratorService } from "../modules/services/workflow/workflow-orchestrator.service";
import { YouTubeService } from "../modules/services/youtube/youtube.service";

export const createApplicationContainer = async () => {
  await connectToDatabase(env.MONGODB_URI);

  const redisConnection = createRedisConnection(env.REDIS_URL);
  const queues = createQueues(redisConnection);
  const storageClient = new LocalStorageClient(env.STORAGE_ROOT);
  const ffmpegClient = new FfmpegClient(env.FFMPEG_PATH);
  const configuredPythonWorkerClient = new PythonWorkerClient(
    env.PYTHON_WORKER_BASE_URL,
    env.PYTHON_WORKER_TIMEOUT_MS
  );
  const youTubeClient = new YouTubeClient({
    clientId: env.YOUTUBE_CLIENT_ID,
    clientSecret: env.YOUTUBE_CLIENT_SECRET,
    redirectUri: env.YOUTUBE_REDIRECT_URI
  });

  const projectRepository = new ProjectRepository();
  const facelessVideoRepository = new FacelessVideoRepository();
  const clipRepository = new ClipRepository();
  const transcriptRepository = new TranscriptRepository();
  const jobRepository = new JobRepository();
  const channelRepository = new ChannelRepository();
  const userRepository = new UserRepository();
  const sourceVideoRepository = new SourceVideoRepository();
  const uploadHistoryRepository = new UploadHistoryRepository();

  const storageService = new StorageService(storageClient);
  await storageService.ensureReady();
  await fs.mkdir(env.TEMP_UPLOAD_DIR, { recursive: true });

  const authTokenService = new AuthTokenService(env.AUTH_TOKEN_SECRET, env.AUTH_TOKEN_TTL_DAYS * 24 * 60 * 60);
  const authService = new AuthService(userRepository, authTokenService);
  const projectService = new ProjectService(projectRepository);
  const redditTrendingService = new RedditTrendingService(projectRepository);
  const sourceVideoService = new SourceVideoService(sourceVideoRepository);
  const transcriptService = new TranscriptService(transcriptRepository, configuredPythonWorkerClient);
  const clipService = new ClipService(clipRepository);
  const queueService = new QueueService(queues);
  const jobService = new JobService(jobRepository);
  const facelessVideoService = new FacelessVideoService(
    projectService,
    jobService,
    queueService,
    configuredPythonWorkerClient,
    facelessVideoRepository,
    redditTrendingService,
    uploadHistoryRepository
  );
  const uploadService = new UploadService(
    storageService,
    projectService,
    sourceVideoService,
    queueService,
    jobService
  );
  const renderService = new RenderService(
    configuredPythonWorkerClient,
    storageService,
    sourceVideoService,
    clipService,
    transcriptService,
    projectService,
    jobService,
    queueService
  );
  const subtitleService = new SubtitleService(clipRepository, clipService, storageService);
  const youTubeService = new YouTubeService(youTubeClient);
  const channelService = new ChannelService(channelRepository, youTubeService);
  const publishService = new PublishService(
    clipService,
    channelService,
    youTubeService,
    storageService,
    uploadHistoryRepository,
    jobService,
    queueService,
    projectService,
    facelessVideoRepository,
    configuredPythonWorkerClient
  );
  const workflowOrchestratorService = new WorkflowOrchestratorService(
    projectService,
    sourceVideoService,
    transcriptService,
    clipService,
    subtitleService,
    jobService,
    queueService,
    storageService,
    configuredPythonWorkerClient,
    renderService,
    publishService
  );

  const reconcileUploadedVideoProjectWorkflows = async () => {
    const uploadedVideoProjects = await projectRepository.findMany({ projectType: "uploaded_video" });

    await Promise.all(
      uploadedVideoProjects.map(async (project) => {
        const projectClips = await clipService.listByProjectId(project.id);

        if (projectClips.length === 0) {
          return;
        }

        const hasPendingReview = projectClips.some((clip) => clip.reviewStatus === "pending_review");
        const hasApprovedAwaitingRender = projectClips.some(
          (clip) =>
            clip.reviewStatus === "approved" &&
            clip.renderStatus !== "rendered" &&
            clip.renderStatus !== "failed"
        );
        const hasApprovedAwaitingPublish = projectClips.some(
          (clip) =>
            clip.reviewStatus === "approved" &&
            clip.renderStatus === "rendered" &&
            clip.publishStatus !== "published"
        );

        let nextWorkflowStage: "review" | "render" | "publish" | "completed" = "completed";
        let nextStatus: "review" | "processing" | "completed" = "completed";

        if (hasPendingReview) {
          nextWorkflowStage = "review";
          nextStatus = "review";
        } else if (hasApprovedAwaitingRender) {
          nextWorkflowStage = "render";
          nextStatus = "processing";
        } else if (hasApprovedAwaitingPublish) {
          nextWorkflowStage = "publish";
          nextStatus = "processing";
        }

        if (project.workflowStage !== nextWorkflowStage || project.status !== nextStatus) {
          await projectService.updateWorkflow(project.id, nextWorkflowStage, nextStatus);
        }
      })
    );
  };

  await reconcileUploadedVideoProjectWorkflows();
  await publishService.backfillPublishedArchives();

  const uploadMiddleware = multer({
    dest: env.TEMP_UPLOAD_DIR,
    limits: {
      fileSize: env.MAX_FILE_SIZE_BYTES
    }
  });
  const authMiddleware = createRequireAuth(authTokenService, userRepository);

  return {
    redisConnection,
    queues,
    uploadMiddleware,
    authMiddleware,
    services: {
      authService,
      projectService,
      sourceVideoService,
      transcriptService,
      clipService,
      queueService,
      jobService,
      uploadService,
      facelessVideoService,
      renderService,
      subtitleService,
      youTubeService,
      channelService,
      publishService,
      storageService,
      workflowOrchestratorService
    },
    controllers: {
      authController: new AuthController(authService),
      healthController: new HealthController(redisConnection),
      uploadController: new UploadController(uploadService),
      projectController: new ProjectController(projectService, facelessVideoService, publishService),
      subtitleController: new SubtitleController(subtitleService),
      channelController: new ChannelController(channelService),
      publishController: new PublishController(publishService),
      jobController: new JobController(jobService),
      clipController: new ClipController(
        clipService,
        renderService,
        sourceVideoService,
        uploadHistoryRepository,
        projectService
      )
    },
    shutdown: async () => {
      await closeQueues(queues);
      await redisConnection.quit();
      await disconnectFromDatabase();
    }
  };
};
