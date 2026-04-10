import { Router } from "express";
import { asyncHandler } from "../../common/middlewares/async-handler.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { AuthController } from "../../modules/controllers/auth/auth.controller";
import { loginSchema, mockLoginSchema, registerSchema } from "../../modules/validators/auth.validator";

export const createAuthRoutes = (authController: AuthController): Router => {
  const router = Router();

  router.post("/register", validate({ body: registerSchema }), asyncHandler(authController.register));
  router.post("/login", validate({ body: loginSchema }), asyncHandler(authController.login));
  router.post("/mock-login", validate({ body: mockLoginSchema }), asyncHandler(authController.mockLogin));

  return router;
};
