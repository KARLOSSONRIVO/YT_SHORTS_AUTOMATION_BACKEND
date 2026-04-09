import { z } from "zod";

export const listJobsQuerySchema = z.object({
  projectId: z.string().min(1)
});
