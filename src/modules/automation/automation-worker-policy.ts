import type { WorkerOptions } from "bullmq";
import { AppError } from "../../common/errors/app-error";
import { env } from "../../config/env";
import { isQueuedWorkflowFailure, isRateLimitFailure, providerRetryDelayMs, shouldRetryResearchFailure } from "./retry-policy";

/**
 * Throttles how fast new runs are *started*. The automation job itself is
 * short - it researches a topic and hands off to the story queue - so this
 * only paces run starts; AUTOMATION_MAX_CONCURRENT_PROJECTS bounds how many
 * runs are in flight.
 */
export const AUTOMATION_RATE_LIMITER = Object.freeze({
  max: env.AUTOMATION_LIMITER_MAX,
  duration: env.AUTOMATION_LIMITER_DURATION_MS
});

export const createWorkerOptions = (connection: WorkerOptions["connection"]) => {
  const shared: WorkerOptions = {
    connection,
    concurrency: env.QUEUE_WORKER_CONCURRENCY,
    settings: {
      backoffStrategy: (attemptsMade: number, type?: string, error?: Error) =>
        type === "provider-rate-limit" ? providerRetryDelayMs(attemptsMade, error) : -1
    }
  };
  return {
    shared,
    automation: { ...shared, limiter: AUTOMATION_RATE_LIMITER } satisfies WorkerOptions,
    // Story stages chain sequentially within a project, so N concurrent
    // projects need exactly N story slots - any more just queues stages that
    // cannot start yet.
    story: { ...shared, concurrency: env.AUTOMATION_MAX_CONCURRENT_PROJECTS } satisfies WorkerOptions
  };
};

export const shouldRetryAutomationFailure = (error: unknown, attemptsMade: number) =>
  isRateLimitFailure(error) || isQueuedWorkflowFailure(error) || shouldRetryResearchFailure(error, attemptsMade);

export const providerFailureMetadata = (error: unknown): Record<string, unknown> => {
  const appError = error instanceof AppError
    ? error
    : error instanceof Error && error.cause instanceof AppError
      ? error.cause
      : undefined;
  if (!appError) return {};
  const details = typeof appError.details === "object" && appError.details
    ? appError.details as Record<string, unknown>
    : {};
  return {
    errorCode: appError.code,
    statusCode: appError.statusCode,
    provider: details.provider,
    providerCode: details.providerCode,
    providerMessage: details.providerMessage,
    retryAfter: details.retryAfter,
    requestId: details.requestId,
    requestBodyBytes: details.requestBodyBytes,
    limitRequests: details.limitRequests,
    remainingRequests: details.remainingRequests,
    resetRequests: details.resetRequests,
    limitTokens: details.limitTokens,
    remainingTokens: details.remainingTokens,
    resetTokens: details.resetTokens
  };
};
