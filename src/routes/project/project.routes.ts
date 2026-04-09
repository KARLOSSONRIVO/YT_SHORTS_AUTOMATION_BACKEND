import { Router } from "express";
import { asyncHandler } from "../../common/middlewares/async-handler.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ProjectController } from "../../modules/controllers/project/project.controller";
import { listProjectsQuerySchema, projectIdParamsSchema } from "../../modules/validators/project.validator";

export const createProjectRoutes = (projectController: ProjectController): Router => {
  const router = Router();

  router.get("/", validate({ query: listProjectsQuerySchema }), asyncHandler(projectController.listProjects));
  router.get(
    "/:projectId",
    validate({ params: projectIdParamsSchema }),
    asyncHandler(projectController.getProject)
  );

  return router;
};
