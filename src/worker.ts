import { UnrecoverableError, Worker, type Processor } from "bullmq";
import { createApplicationContainer } from "./config/container";
import { logger } from "./config/logger";
import { QUEUE_NAMES } from "./infrastructure/queue/queue.names";
import { isRateLimitFailure } from "./modules/automation/retry-policy";
import { createWorkerOptions, providerFailureMetadata, shouldRetryAutomationFailure } from "./modules/automation/automation-worker-policy";

const unrecoverableWithCause = (error: unknown, fallback: string) => {
  const wrapped = new UnrecoverableError(error instanceof Error ? error.message : fallback);
  wrapped.cause = error;
  return wrapped;
};

const bootstrap = async () => {
  const container = await createApplicationContainer();
  const connection = container.redisConnection;
  const workflowOrchestratorService = container.services.workflowOrchestratorService;
  const facelessVideoService = container.services.facelessVideoService;
  const automationService = container.services.automationService;

  const workerOptions = createWorkerOptions(connection);

  const workers = [
    new Worker(
      QUEUE_NAMES.INGEST,
      (async (job) => workflowOrchestratorService.processIngest(job.data)) as Processor,
      workerOptions.shared
    ),
    new Worker(
      QUEUE_NAMES.TRANSCRIPTION,
      (async (job) => workflowOrchestratorService.processTranscription(job.data)) as Processor,
      workerOptions.shared
    ),
    new Worker(
      QUEUE_NAMES.ANALYSIS,
      (async (job) => workflowOrchestratorService.processAnalysis(job.data)) as Processor,
      workerOptions.shared
    ),
    new Worker(
      QUEUE_NAMES.STORY,
      (async (job) => { try { return await facelessVideoService.processStage(job.data); } catch (error) {
        if (!isRateLimitFailure(error)) throw unrecoverableWithCause(error, "Permanent story-stage failure");
        throw error;
      } }) as Processor,
      workerOptions.story
    ),
    new Worker(
      QUEUE_NAMES.AUTOMATION,
      (async (job) => { const automationRunId = job.id == null ? undefined : String(job.id); try { return await automationService.execute(String(job.data.projectId), job.data.scheduledDate ? String(job.data.scheduledDate) : undefined,
        job.data.trigger === "manual" ? "manual" : "scheduled", automationRunId); } catch (error) {
        await automationService.recordFailure(String(job.data.projectId), error, automationRunId).catch(() => undefined);
        if (!shouldRetryAutomationFailure(error, job.attemptsMade)) throw unrecoverableWithCause(error, "Permanent automation failure");
        throw error;
      } }) as Processor,
      workerOptions.automation
    ),
    new Worker(
      QUEUE_NAMES.RENDER,
      (async (job) => workflowOrchestratorService.processRender(job.data)) as Processor,
      workerOptions.shared
    ),
    new Worker(
      QUEUE_NAMES.UPLOAD,
      (async (job) => workflowOrchestratorService.processPublish(job.data)) as Processor,
      workerOptions.shared
    )
  ];

  for (const worker of workers) {
    worker.on("completed", (job) => {
      logger.info("Queue job completed.", {
        queueName: worker.name,
        bullJobId: job.id,
        name: job.name
      });
    });

    worker.on("failed", (job, error) => {
      logger.error("Queue job failed.", {
        queueName: worker.name,
        bullJobId: job?.id,
        name: job?.name,
        message: error.message,
        ...providerFailureMetadata(error)
      });
    });
  }

  logger.info("Backend worker process started.", {
    queues: Object.values(QUEUE_NAMES)
  });

  const shutdown = async (signal: string) => {
    logger.info("Shutting down backend worker process.", { signal });
    await Promise.all(workers.map((worker) => worker.close()));
    await container.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

void bootstrap().catch((error: Error) => {
  logger.error("Failed to bootstrap backend worker process.", {
    message: error.message,
    stack: error.stack
  });
  process.exit(1);
});
