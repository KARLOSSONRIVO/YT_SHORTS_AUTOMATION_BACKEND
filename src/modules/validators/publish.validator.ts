import { z } from "zod";

export const publishClipSchema = z.object({
  clipId: z.string().min(1),
  channelId: z.string().min(1),
  title: z.string().min(3).max(100),
  description: z.string().max(5000).default(""),
  privacyStatus: z.enum(["private", "public", "unlisted"]).default("private")
});
