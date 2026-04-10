import path from "node:path";
import cors from "cors";
import express from "express";
import type { Multer } from "multer";
import { errorHandler } from "./common/middlewares/error-handler.middleware";
import { notFoundHandler } from "./common/middlewares/not-found.middleware";
import { env } from "./config/env";
import { createApiRouter, type RouteControllers } from "./routes";

export const createApp = (controllers: RouteControllers, uploadMiddleware: Multer) => {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/media", express.static(path.resolve(env.STORAGE_ROOT), { fallthrough: true, index: false }));

  app.use(env.API_PREFIX, createApiRouter(controllers, uploadMiddleware));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
