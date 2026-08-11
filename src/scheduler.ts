import { createApplicationContainer } from "./config/container";
import { env } from "./config/env";
import { logger } from "./config/logger";

const bootstrap = async () => {
  const container = await createApplicationContainer();
  const tick = async () => {
    try {
      await container.services.automationService.enqueueDue();
      const results = await container.services.automationService.reconcile();
      for (const result of results) if (result instanceof Error)
        logger.error("Automation content reconciliation failed.", { message: result.message });
    }
    catch (error) { logger.error("Automation scheduler tick failed.", { message: error instanceof Error ? error.message : "Unknown scheduler error" }); }
  };
  await tick(); const timer = setInterval(() => void tick(), env.AUTOMATION_SCHEDULER_INTERVAL_MS);
  const shutdown = async () => { clearInterval(timer); await container.shutdown(); process.exit(0); };
  process.on("SIGINT", () => void shutdown()); process.on("SIGTERM", () => void shutdown());
  logger.info("Project daily-story scheduler started.", { intervalMs: env.AUTOMATION_SCHEDULER_INTERVAL_MS });
};
void bootstrap().catch((error: Error) => { logger.error("Scheduler bootstrap failed.", { message: error.message }); process.exit(1); });
