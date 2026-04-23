import { Router } from "express";
import type { Multer } from "multer";
import type { RequestHandler } from "express";
import { asyncHandler } from "../common/middlewares/async-handler.middleware";
import { validate } from "../common/middlewares/validate.middleware";
import type { AuthController } from "../modules/controllers/auth/auth.controller";
import type { ChannelController } from "../modules/controllers/channel/channel.controller";
import type { ClipController } from "../modules/controllers/clip/clip.controller";
import type { HealthController } from "../modules/controllers/health/health.controller";
import type { JobController } from "../modules/controllers/job/job.controller";
import type { ProjectController } from "../modules/controllers/project/project.controller";
import type { PublishController } from "../modules/controllers/publish/publish.controller";
import type { SubtitleController } from "../modules/controllers/subtitle/subtitle.controller";
import type { UploadController } from "../modules/controllers/upload/upload.controller";
import { createAuthRoutes } from "./auth/auth.routes";
import { createChannelRoutes } from "./channel/channel.routes";
import { createClipRoutes } from "./clip/clip.routes";
import { createHealthRoutes } from "./health/health.routes";
import { createJobRoutes } from "./job/job.routes";
import { createProjectRoutes } from "./project/project.routes";
import { createPublishRoutes } from "./publish/publish.routes";
import { createSubtitleRoutes } from "./subtitle/subtitle.routes";
import { createUploadRoutes } from "./upload/upload.routes";
import { connectChannelCallbackQuerySchema } from "../modules/validators/channel.validator";

export interface RouteControllers {
  authController: AuthController;
  healthController: HealthController;
  uploadController: UploadController;
  projectController: ProjectController;
  clipController: ClipController;
  subtitleController: SubtitleController;
  channelController: ChannelController;
  publishController: PublishController;
  jobController: JobController;
}

export const createApiRouter = (
  controllers: RouteControllers,
  uploadMiddleware: Multer,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.use("/auth", createAuthRoutes(controllers.authController));
  router.use("/health", createHealthRoutes(controllers.healthController));
  router.get(
    "/channel/oauth/callback",
    validate({ query: connectChannelCallbackQuerySchema }),
    asyncHandler(controllers.channelController.connectChannelFromCallback)
  );
  router.use(authMiddleware);
  router.use("/upload", createUploadRoutes(controllers.uploadController, uploadMiddleware));
  router.use("/project", createProjectRoutes(controllers.projectController));
  router.use("/projects", createProjectRoutes(controllers.projectController));
  router.use("/clip", createClipRoutes(controllers.clipController));
  router.use("/subtitle", createSubtitleRoutes(controllers.subtitleController));
  router.use("/channel", createChannelRoutes(controllers.channelController));
  router.use("/publish", createPublishRoutes(controllers.publishController));
  router.use("/job", createJobRoutes(controllers.jobController));

  return router;
};
