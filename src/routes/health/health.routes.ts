import { Router } from "express";
import { asyncHandler } from "../../common/middlewares/async-handler.middleware";
import { HealthController } from "../../modules/controllers/health/health.controller";

export const createHealthRoutes = (healthController: HealthController): Router => {
  const router = Router();

  router.get("/", asyncHandler(healthController.getStatus));

  return router;
};
