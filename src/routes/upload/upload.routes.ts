import { Router } from "express";
import type { Multer } from "multer";
import { asyncHandler } from "../../common/middlewares/async-handler.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { UploadController } from "../../modules/controllers/upload/upload.controller";
import { createUploadBodySchema } from "../../modules/validators/upload.validator";

export const createUploadRoutes = (uploadController: UploadController, uploadMiddleware: Multer): Router => {
  const router = Router();

  router.post(
    "/",
    uploadMiddleware.single("video"),
    validate({ body: createUploadBodySchema }),
    asyncHandler(uploadController.createUpload)
  );

  return router;
};
