import type IORedis from "ioredis";
import { Queue, type JobsOptions } from "bullmq";
import { QUEUE_NAMES, type QueueName } from "./queue.names";

type GenerationQueueName = typeof QUEUE_NAMES.STORY | typeof QUEUE_NAMES.AUTOMATION;
export type QueueRegistry = Record<Exclude<QueueName, GenerationQueueName>, Queue> & Partial<Record<GenerationQueueName, Queue>>;

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  removeOnComplete: 100,
  removeOnFail: 100,
  backoff: { type: "exponential", delay: 5000 }
};

export const createQueues = (connection: IORedis): QueueRegistry => {
  return {
    [QUEUE_NAMES.INGEST]: new Queue(QUEUE_NAMES.INGEST, { connection, defaultJobOptions }),
    [QUEUE_NAMES.TRANSCRIPTION]: new Queue(QUEUE_NAMES.TRANSCRIPTION, { connection, defaultJobOptions }),
    [QUEUE_NAMES.ANALYSIS]: new Queue(QUEUE_NAMES.ANALYSIS, { connection, defaultJobOptions }),
    [QUEUE_NAMES.RENDER]: new Queue(QUEUE_NAMES.RENDER, { connection, defaultJobOptions }),
    [QUEUE_NAMES.UPLOAD]: new Queue(QUEUE_NAMES.UPLOAD, { connection, defaultJobOptions }),
  };
};

export const closeQueues = async (queues: QueueRegistry): Promise<void> => {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
};
