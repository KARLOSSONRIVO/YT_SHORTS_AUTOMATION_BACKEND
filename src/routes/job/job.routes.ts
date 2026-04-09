import { Router } from "express";
import { asyncHandler } from "../../common/middlewares/async-handler.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { JobController } from "../../modules/controllers/job/job.controller";
import { listJobsQuerySchema } from "../../modules/validators/job.validator";

export const createJobRoutes = (jobController: JobController): Router => {
  const router = Router();

  router.get("/", validate({ query: listJobsQuerySchema }), asyncHandler(jobController.listJobs));

  return router;
};
