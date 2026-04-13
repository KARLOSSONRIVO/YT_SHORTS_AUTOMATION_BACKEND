import { z } from "zod";

export const projectIdParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const listProjectsQuerySchema = z.object({
  userId: z.string().min(1).optional()
});

export const createFacelessProjectBodySchema = z.object({
  userId: z.string().min(1),
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(5000).optional(),
  topic: z.string().min(2).max(240),
  platforms: z.array(z.enum(["youtube", "tiktok"])).min(1).default(["youtube", "tiktok"]).optional(),
  targetDurationSeconds: z.coerce.number().int().min(15).max(180).default(45).optional(),
  stylePreset: z.string().min(1).max(160).default("cinematic documentary").optional(),
  voice: z.string().min(1).max(80).default("af_sarah").optional(),
  tone: z.string().min(1).max(80).optional(),
  audience: z.string().min(1).max(120).optional()
});
