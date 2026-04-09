import { Router } from "express";
import { asyncHandler } from "../../common/middlewares/async-handler.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { PublishController } from "../../modules/controllers/publish/publish.controller";
import { publishClipSchema } from "../../modules/validators/publish.validator";

export const createPublishRoutes = (publishController: PublishController): Router => {
  const router = Router();

  router.post("/", validate({ body: publishClipSchema }), asyncHandler(publishController.queuePublish));

  return router;
};
