import { Router } from "express";
import { asyncHandler } from "../../common/middlewares/async-handler.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ClipController } from "../../modules/controllers/clip/clip.controller";
import { clipIdParamsSchema, listClipsQuerySchema, reviewClipBodySchema } from "../../modules/validators/clip.validator";

export const createClipRoutes = (clipController: ClipController): Router => {
  const router = Router();

  router.get("/", validate({ query: listClipsQuerySchema }), asyncHandler(clipController.listClips));
  router.patch(
    "/:clipId/review",
    validate({ params: clipIdParamsSchema, body: reviewClipBodySchema }),
    asyncHandler(clipController.reviewClip)
  );

  return router;
};
