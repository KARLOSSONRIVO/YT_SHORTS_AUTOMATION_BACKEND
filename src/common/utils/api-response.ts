import type { Response } from "express";

export const sendSuccess = <T>(response: Response, data: T, statusCode = 200, meta?: unknown): void => {
  response.status(statusCode).json({
    success: true,
    data,
    ...(meta !== undefined ? { meta } : {})
  });
};
