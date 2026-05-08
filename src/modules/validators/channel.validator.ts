import { z } from "zod";

export const connectChannelBodySchema = z.object({
  code: z.string().min(1)
});

export const getChannelAuthorizationUrlQuerySchema = z.object({});

export const connectChannelCallbackQuerySchema = z.object({
  state: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  error_code: z.union([z.string(), z.number()]).optional(),
  error_message: z.string().optional(),
  error_reason: z.string().optional()
});

export const channelIdParamsSchema = z.object({
  channelId: z.string().min(1)
});
