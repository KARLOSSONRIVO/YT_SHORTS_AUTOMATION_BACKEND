import { z } from "zod";

export const channelUserQuerySchema = z.object({
  userId: z.string().min(1)
});

export const connectChannelBodySchema = z.object({
  userId: z.string().min(1),
  code: z.string().min(1)
});

export const connectChannelCallbackQuerySchema = z.object({
  state: z.string().min(1),
  code: z.string().min(1)
});
