import { z } from "zod";

export const subtitleClipParamsSchema = z.object({
  clipId: z.string().min(1)
});
