import { AppError } from "../../common/errors/app-error";
const TEMPORARY_CODES = new Set(["ECONNRESET","ETIMEDOUT","ECONNREFUSED","RATE_LIMITED","DAILY_UPLOAD_LIMIT_REACHED"]);
const RETRYABLE_RESEARCH_CODES = new Set(["RESEARCH_RESPONSE_INVALID", "INSUFFICIENT_RESEARCH_CANDIDATES", "GROQ_COMPOUND_REQUEST_TOO_LARGE"]);
export const isRateLimitFailure = (error: unknown) => {
  if (error instanceof AppError) return error.statusCode === 429 && !["AUTOMATION_JOB_QUEUED", "DAILY_UPLOAD_LIMIT_REACHED"].includes(error.code);
  const responseStatus = typeof error === "object" && error && "response" in error ? Number((error as {response?:{status?:unknown}}).response?.status) : 0;
  const statusCode = typeof error === "object" && error && "statusCode" in error ? Number((error as {statusCode?:unknown}).statusCode) : 0;
  return responseStatus === 429 || statusCode === 429;
};
export const isQueuedWorkflowFailure = (error: unknown) => error instanceof AppError && error.code === "AUTOMATION_JOB_QUEUED";
export const isTemporaryFailure = (error: unknown) => {
  if (error instanceof AppError) return error.statusCode >= 500 || error.statusCode === 429;
  const code = typeof error === "object" && error && "code" in error ? String((error as {code?:unknown}).code) : "";
  const responseStatus = typeof error === "object" && error && "response" in error ? Number((error as {response?:{status?:unknown}}).response?.status) : 0;
  if (responseStatus === 429 || responseStatus >= 500) return true;
  return TEMPORARY_CODES.has(code);
};
export const retryDelayMs = (attempt: number, base = 5000, cap = 300000) => Math.min(base * 2 ** Math.max(attempt - 1, 0), cap);
export const providerRetryDelayMs = (attempt: number, error?: unknown) => {
  const details = error instanceof AppError && typeof error.details === "object" && error.details
    ? error.details as { retryAfter?: unknown }
    : undefined;
  const retryAfterSeconds = Number(details?.retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) return Math.ceil(retryAfterSeconds * 1000);
  return [30_000, 60_000, 120_000][Math.min(Math.max(attempt - 1, 0), 2)];
};
export const isRetryableResearchFailure = (error: unknown) => error instanceof AppError && RETRYABLE_RESEARCH_CODES.has(error.code);
export const shouldRetryResearchFailure = (error: unknown, attemptsMade: number) => isRetryableResearchFailure(error) && attemptsMade < 2;
