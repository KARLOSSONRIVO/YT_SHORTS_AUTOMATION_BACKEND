import { Router } from "express";
import { asyncHandler } from "../../common/middlewares/async-handler.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { SubtitleController } from "../../modules/controllers/subtitle/subtitle.controller";
import { subtitleClipParamsSchema } from "../../modules/validators/subtitle.validator";

export const createSubtitleRoutes = (subtitleController: SubtitleController): Router => {
  const router = Router();

  router.get(
    "/clips/:clipId",
    validate({ params: subtitleClipParamsSchema }),
    asyncHandler(subtitleController.getClipSubtitle)
  );

  return router;
};
