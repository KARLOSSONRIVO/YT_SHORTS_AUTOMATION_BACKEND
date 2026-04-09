import type { Request, Response } from "express";
import mongoose from "mongoose";
import type IORedis from "ioredis";
import { sendSuccess } from "../../../common/utils/api-response";

export class HealthController {
  constructor(private readonly redisConnection: IORedis) {}

  public getStatus = async (_request: Request, response: Response): Promise<void> => {
    sendSuccess(response, {
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        api: "up",
        mongodb: mongoose.connection.readyState === 1 ? "up" : "down",
        redis: this.redisConnection.status === "ready" ? "up" : this.redisConnection.status
      }
    });
  };
}
