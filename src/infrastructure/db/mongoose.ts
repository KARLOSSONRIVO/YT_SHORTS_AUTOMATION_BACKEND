import mongoose from "mongoose";
import { logger } from "../../config/logger";

export const connectToDatabase = async (mongoUri: string): Promise<void> => {
  await mongoose.connect(mongoUri);
  logger.info("MongoDB connected.");
};

export const disconnectFromDatabase = async (): Promise<void> => {
  await mongoose.disconnect();
  logger.info("MongoDB disconnected.");
};
