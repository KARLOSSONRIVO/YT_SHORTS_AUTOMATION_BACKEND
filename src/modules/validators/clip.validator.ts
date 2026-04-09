import { z } from "zod";

export const listClipsQuerySchema = z.object({
  projectId: z.string().min(1)
});

export const clipIdParamsSchema = z.object({
  clipId: z.string().min(1)
});

export const reviewClipBodySchema = z.object({
  reviewStatus: z.enum(["approved", "rejected"])
});
