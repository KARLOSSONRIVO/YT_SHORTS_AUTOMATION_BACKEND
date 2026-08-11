import { Router } from "express";
import { asyncHandler } from "../../common/middlewares/async-handler.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import type { ProjectController } from "../../modules/controllers/project/project.controller";
import type { Multer } from "multer";
import type { RequestHandler } from "express";
import { clipParamsSchema, clipUploadBodySchema, createProjectBodySchema, nicheActiveBodySchema, nicheParamsSchema,
  projectAccountParamsSchema, projectIdParamsSchema, projectStoryParamsSchema, redditRejectBodySchema,
  redditSourceParamsSchema, reorderClipsBodySchema, scheduleClipBodySchema, subredditBodySchema,
  updateProjectBodySchema } from "../../modules/validators/project.validator";

export const createProjectRoutes = (controller: ProjectController, uploadMiddleware?: Multer): Router => {
  const router = Router();
  const clipFiles: RequestHandler = uploadMiddleware
    ? uploadMiddleware.fields([{ name: "video", maxCount: 1 }, { name: "thumbnail", maxCount: 1 }, { name: "subtitles", maxCount: 1 }])
    : (_request, _response, next) => next();
  router.get("/niches", asyncHandler(controller.listNiches));
  router.post("/niches/seed", asyncHandler(controller.seedNiches));
  router.post("/niches", asyncHandler(controller.createNiche));
  router.get("/niches/:nicheId", validate({ params: nicheParamsSchema }), asyncHandler(controller.getNiche));
  router.patch("/niches/:nicheId", validate({ params: nicheParamsSchema }), asyncHandler(controller.updateNiche));
  router.post("/niches/:nicheId/active", validate({ params: nicheParamsSchema, body: nicheActiveBodySchema }), asyncHandler(controller.setNicheActive));
  router.get("/reddit/subreddits", asyncHandler(controller.redditApproved));
  router.post("/reddit/test", asyncHandler(controller.redditTest));
  router.post("/reddit/validate", validate({ body: subredditBodySchema }), asyncHandler(controller.redditValidate));
  router.get("/voice-registry", asyncHandler(controller.listVoices));
  router.get("/accounts/:accountId/validate", validate({ params: projectAccountParamsSchema }), asyncHandler(controller.validateAccount));
  router.get("/", asyncHandler(controller.listProjects));
  router.post("/", validate({ body: createProjectBodySchema }), asyncHandler(controller.createProject));
  router.get("/:projectId/dashboard", validate({ params: projectIdParamsSchema }), asyncHandler(controller.dashboard));
  router.get("/:projectId/stories", validate({ params: projectIdParamsSchema }), asyncHandler(controller.stories));
  router.get("/:projectId/rejected-topics", validate({ params: projectIdParamsSchema }), asyncHandler(controller.rejected));
  router.get("/:projectId/activity", validate({ params: projectIdParamsSchema }), asyncHandler(controller.activity));
  router.post("/:projectId/generate-now", validate({ params: projectIdParamsSchema }), asyncHandler(controller.generateNow));
  router.get("/:projectId/reddit/preview", validate({ params: projectIdParamsSchema }), asyncHandler(controller.redditPreview));
  router.get("/:projectId/reddit/history", validate({ params: projectIdParamsSchema }), asyncHandler(controller.redditHistory));
  router.post("/:projectId/reddit/fetch-now", validate({ params: projectIdParamsSchema }), asyncHandler(controller.redditFetch));
  router.post("/:projectId/reddit/sources/:sourceId/reject", validate({ params: redditSourceParamsSchema, body: redditRejectBodySchema }), asyncHandler(controller.redditReject));
  router.get("/:projectId/clips", validate({ params: projectIdParamsSchema }), asyncHandler(controller.clips));
  router.get("/:projectId/clips/history", validate({ params: projectIdParamsSchema }), asyncHandler(controller.clipHistory));
  router.post("/:projectId/clips", clipFiles, validate({ params: projectIdParamsSchema, body: clipUploadBodySchema }), asyncHandler(controller.addClip));
  router.put("/:projectId/clips/:clipId/file", clipFiles, validate({ params: clipParamsSchema }), asyncHandler(controller.replaceClip));
  router.post("/:projectId/clips/reorder", validate({ params: projectIdParamsSchema, body: reorderClipsBodySchema }), asyncHandler(controller.reorderClips));
  router.post("/:projectId/clips/:clipId/schedule", validate({ params: clipParamsSchema, body: scheduleClipBodySchema }), asyncHandler(controller.scheduleClip));
  router.post("/:projectId/clips/:clipId/upload-now", validate({ params: clipParamsSchema }), asyncHandler(controller.uploadClipNow));
  router.post("/:projectId/clips/:clipId/retry", validate({ params: clipParamsSchema }), asyncHandler(controller.retryClip));
  router.delete("/:projectId/clips/:clipId", validate({ params: clipParamsSchema }), asyncHandler(controller.removeClip));
  router.post("/:projectId/pause", validate({ params: projectIdParamsSchema }), asyncHandler(controller.pause));
  router.post("/:projectId/resume", validate({ params: projectIdParamsSchema }), asyncHandler(controller.resume));
  router.post("/:projectId/stories/:storyId/approve", validate({ params: projectStoryParamsSchema }), asyncHandler(controller.approveStory));
  router.post("/:projectId/stories/:storyId/reject", validate({ params: projectStoryParamsSchema }), asyncHandler(controller.rejectStory));
  router.post("/:projectId/stories/:storyId/retry-generation", validate({ params: projectStoryParamsSchema }), asyncHandler(controller.retryGeneration));
  router.post("/:projectId/stories/:storyId/retry-upload", validate({ params: projectStoryParamsSchema }), asyncHandler(controller.retryUpload));
  router.get("/:projectId", validate({ params: projectIdParamsSchema }), asyncHandler(controller.getProject));
  router.patch("/:projectId", validate({ params: projectIdParamsSchema, body: updateProjectBodySchema }), asyncHandler(controller.updateProject));
  router.delete("/:projectId", validate({ params: projectIdParamsSchema }), asyncHandler(controller.deleteProject));
  return router;
};
