import { z } from "zod";

export const connectChannelBodySchema = z.object({
  code: z.string().min(1)
});

export const connectChannelCallbackQuerySchema = z.object({
  state: z.string().min(1),
  code: z.string().min(1)
});

export const channelIdParamsSchema = z.object({
  channelId: z.string().min(1)
});
