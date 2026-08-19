import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5001),
  API_PREFIX: z.string().default("/api"),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PYTHON_WORKER_BASE_URL: z.string().url(),
  PYTHON_WORKER_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(0),
  YOUTUBE_CLIENT_ID: z.string().min(1),
  YOUTUBE_CLIENT_SECRET: z.string().min(1),
  YOUTUBE_REDIRECT_URI: z.string().url(),
  REDDIT_USER_AGENT: z.string().min(3).default("ShortsStudio/2.0 (unified-story-automation)"),
  FRONTEND_APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_TOKEN_SECRET: z.string().min(16).default("shorts-studio-dev-auth-secret"),
  AUTH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  STORAGE_ROOT: z.string().default("./storage"),
  TEMP_UPLOAD_DIR: z.string().default("./storage/tmp"),
  MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(1024 * 1024 * 1024),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  GROQ_API_KEY: z.string().min(1).optional(),
  GROQ_TOPIC_RESEARCH_MODEL: z.string().default("groq/compound-mini"),
  GROQ_TOPIC_RESEARCH_FALLBACK_MODEL: z.string().default("qwen/qwen3.6-27b"),
  GROQ_TOPIC_RESEARCH_SECONDARY_FALLBACK_MODEL: z.string().default("openai/gpt-oss-20b"),
  GROQ_API_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  AUTOMATION_SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(10000).default(60000)
});

const parsedEnv = envSchema.parse(process.env);

export const env = {
  ...parsedEnv,
  STORAGE_ROOT: path.resolve(process.cwd(), parsedEnv.STORAGE_ROOT),
  TEMP_UPLOAD_DIR: path.resolve(process.cwd(), parsedEnv.TEMP_UPLOAD_DIR)
};

export type AppEnv = typeof env;
