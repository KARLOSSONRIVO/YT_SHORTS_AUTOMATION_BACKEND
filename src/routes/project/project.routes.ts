import { Router } from "express";
import { asyncHandler } from "../../common/middlewares/async-handler.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ProjectController } from "../../modules/controllers/project/project.controller";
import {
  createFacelessProjectBodySchema,
  createTrendingRedditProjectBodySchema,
  publishFacelessProjectBodySchema,
  projectIdParamsSchema,
  voiceParamsSchema
} from "../../modules/validators/project.validator";

export const createProjectRoutes = (projectController: ProjectController): Router => {
  const router = Router();

  router.post("/", validate({ body: createFacelessProjectBodySchema }), asyncHandler(projectController.createProject));
  router.post(
    "/reddit/trending",
    validate({ body: createTrendingRedditProjectBodySchema }),
    asyncHandler(projectController.createTrendingRedditProject)
  );
  router.get("/", asyncHandler(projectController.listProjects));
  router.get("/faceless/voices", asyncHandler(projectController.listVoices));
  router.get(
    "/faceless/voices/:voice/preview",
    validate({ params: voiceParamsSchema }),
    asyncHandler(projectController.previewVoice)
  );
  router.get(
    "/:projectId/status",
    validate({ params: projectIdParamsSchema }),
    asyncHandler(projectController.getProjectStatus)
  );
  router.post(
    "/:projectId/generate-script",
    validate({ params: projectIdParamsSchema }),
    asyncHandler(projectController.generateScript)
  );
  router.delete(
    "/:projectId",
    validate({ params: projectIdParamsSchema }),
    asyncHandler(projectController.deleteProject)
  );
  router.post(
    "/:projectId/run",
    validate({ params: projectIdParamsSchema }),
    asyncHandler(projectController.runFacelessAutomation)
  );
  router.post(
    "/:projectId/generate-audio",
    validate({ params: projectIdParamsSchema }),
    asyncHandler(projectController.generateAudio)
  );
  router.post(
    "/:projectId/generate-subtitles",
    validate({ params: projectIdParamsSchema }),
    asyncHandler(projectController.generateSubtitles)
  );
  router.post(
    "/:projectId/generate-scenes",
    validate({ params: projectIdParamsSchema }),
    asyncHandler(projectController.generateScenes)
  );
  router.post(
    "/:projectId/generate-animations",
    validate({ params: projectIdParamsSchema }),
    asyncHandler(projectController.generateAnimations)
  );
  router.post(
    "/:projectId/generate-ambience",
    validate({ params: projectIdParamsSchema }),
    asyncHandler(projectController.generateAmbience)
  );
  router.post("/:projectId/render", validate({ params: projectIdParamsSchema }), asyncHandler(projectController.render));
  router.post(
    "/:projectId/publish",
    validate({ params: projectIdParamsSchema, body: publishFacelessProjectBodySchema }),
    asyncHandler(projectController.publishProject)
  );
  router.get(
    "/:projectId/assets",
    validate({ params: projectIdParamsSchema }),
    asyncHandler(projectController.listAssets)
  );
  router.get(
    "/:projectId",
    validate({ params: projectIdParamsSchema }),
    asyncHandler(projectController.getProject)
  );

  return router;
};
