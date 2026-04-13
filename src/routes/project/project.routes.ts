import { Router } from "express";
import { asyncHandler } from "../../common/middlewares/async-handler.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ProjectController } from "../../modules/controllers/project/project.controller";
import {
  createFacelessProjectBodySchema,
  listProjectsQuerySchema,
  projectIdParamsSchema
} from "../../modules/validators/project.validator";

export const createProjectRoutes = (projectController: ProjectController): Router => {
  const router = Router();

  router.post("/", validate({ body: createFacelessProjectBodySchema }), asyncHandler(projectController.createProject));
  router.get("/", validate({ query: listProjectsQuerySchema }), asyncHandler(projectController.listProjects));
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
  router.post("/:projectId/render", validate({ params: projectIdParamsSchema }), asyncHandler(projectController.render));
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
