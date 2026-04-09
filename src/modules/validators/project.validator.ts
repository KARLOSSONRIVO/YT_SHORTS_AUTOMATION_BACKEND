import { z } from "zod";

export const projectIdParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const listProjectsQuerySchema = z.object({
  userId: z.string().min(1).optional()
});
