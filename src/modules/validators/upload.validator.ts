import { z } from "zod";

export const createUploadBodySchema = z.object({
  userId: z.string().min(1),
  title: z.string().min(3).max(160),
  description: z.string().max(5000).optional()
});
