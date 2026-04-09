import { createServer } from "node:http";
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { createApplicationContainer } from "./config/container";

const bootstrap = async () => {
  const container = await createApplicationContainer();
  const app = createApp(container.controllers, container.uploadMiddleware);
  const server = createServer(app);

  server.listen(env.PORT, () => {
    logger.info("Backend server started.", {
      port: env.PORT,
      apiPrefix: env.API_PREFIX,
      nodeEnv: env.NODE_ENV
    });
  });

  const shutdown = async (signal: string) => {
    logger.info("Shutting down backend server.", { signal });
    server.close(async () => {
      await container.shutdown();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

void bootstrap().catch((error: Error) => {
  logger.error("Failed to bootstrap backend server.", {
    message: error.message,
    stack: error.stack
  });
  process.exit(1);
});
