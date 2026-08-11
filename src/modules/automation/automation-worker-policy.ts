import type { WorkerOptions } from "bullmq";
import { AppError } from "../../common/errors/app-error";
import { isQueuedWorkflowFailure, isRateLimitFailure, providerRetryDelayMs, shouldRetryResearchFailure } from "./retry-policy";

export const AUTOMATION_RATE_LIMITER = Object.freeze({ max: 1, duration: 60_000 });

export const createWorkerOptions = (connection: WorkerOptions["connection"]) => {
  const shared: WorkerOptions = {
    connection,
    concurrency: 1,
    settings: {
      backoffStrategy: (attemptsMade: number, type?: string, error?: Error) =>
        type === "provider-rate-limit" ? providerRetryDelayMs(attemptsMade, error) : -1
    }
  };
  return {
    shared,
    automation: { ...shared, limiter: AUTOMATION_RATE_LIMITER } satisfies WorkerOptions
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
