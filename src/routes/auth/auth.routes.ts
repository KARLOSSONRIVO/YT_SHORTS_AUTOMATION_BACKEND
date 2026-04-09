import { Router } from "express";
import { asyncHandler } from "../../common/middlewares/async-handler.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { AuthController } from "../../modules/controllers/auth/auth.controller";
import { mockLoginSchema } from "../../modules/validators/auth.validator";

export const createAuthRoutes = (authController: AuthController): Router => {
  const router = Router();

  router.post("/mock-login", validate({ body: mockLoginSchema }), asyncHandler(authController.mockLogin));

  return router;
};
