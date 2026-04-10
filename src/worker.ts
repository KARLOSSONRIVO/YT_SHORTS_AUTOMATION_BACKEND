import { Worker, type Processor, type WorkerOptions } from "bullmq";
import { createApplicationContainer } from "./config/container";
import { logger } from "./config/logger";
import { QUEUE_NAMES } from "./infrastructure/queue/queue.names";

const bootstrap = async () => {
  const container = await createApplicationContainer();
  const connection = container.redisConnection;
  const workflowOrchestratorService = container.services.workflowOrchestratorService;

  const workerOptions: WorkerOptions = {
    connection,
    concurrency: 1
  };

  const workers = [
    new Worker(
      QUEUE_NAMES.INGEST,
      (async (job) => workflowOrchestratorService.processIngest(job.data)) as Processor,
      workerOptions
    ),
    new Worker(
      QUEUE_NAMES.TRANSCRIPTION,
      (async (job) => workflowOrchestratorService.processTranscription(job.data)) as Processor,
      workerOptions
    ),
    new Worker(
      QUEUE_NAMES.ANALYSIS,
      (async (job) => workflowOrchestratorService.processAnalysis(job.data)) as Processor,
      workerOptions
    ),
    new Worker(
      QUEUE_NAMES.RENDER,
      (async (job) => workflowOrchestratorService.processRender(job.data)) as Processor,
      workerOptions
    ),
    new Worker(
      QUEUE_NAMES.UPLOAD,
      (async (job) => workflowOrchestratorService.processPublish(job.data)) as Processor,
      workerOptions
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
        message: error.message
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
