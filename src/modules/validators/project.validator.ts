import { z } from "zod";

export const projectIdParamsSchema = z.object({
  projectId: z.string().min(1)
});

export const voiceParamsSchema = z.object({
  voice: z.string().min(1)
});

export const createFacelessProjectBodySchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(5000).optional(),
  topic: z.string().min(2).max(240),
  platforms: z.array(z.enum(["youtube", "tiktok"])).min(1).default(["youtube"]).optional(),
  targetDurationSeconds: z.coerce.number().int().min(15).max(180).default(45).optional(),
  stylePreset: z.string().min(1).max(160).default("cinematic documentary").optional(),
  scriptFramework: z.enum(["psychology_truth", "history_story"]).default("psychology_truth").optional(),
  facelessRenderMode: z.enum(["image_story", "animation_story"]).default("image_story").optional(),
  voice: z.string().min(1).max(80).default("af_sarah").optional(),
  tone: z.string().min(1).max(80).optional(),
  audience: z.string().min(1).max(120).optional()
});

export const createTrendingRedditProjectBodySchema = z.object({
  topic: z.string().trim().min(2).max(80).optional(),
  maxDurationSeconds: z.coerce.number().int().min(15).max(180).optional(),
  voice: z.string().min(1).max(80).default("af_sarah").optional(),
  subtitlePreferences: z
    .object({
      fontFamily: z.string().min(1).max(120).optional(),
      fontSize: z.coerce.number().int().min(24).max(120).optional(),
      fillColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      strokeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      highlightColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      position: z.enum(["bottom_center", "top_center", "middle_center"]).optional(),
      maxCharsPerLine: z.coerce.number().int().min(12).max(42).optional(),
      maxLines: z.coerce.number().int().min(1).max(4).optional()
    })
    .optional()
});

export const publishFacelessProjectBodySchema = z.object({
  channelId: z.string().min(1),
  title: z.string().min(1).max(100),
  description: z.string().max(5000).optional().default(""),
  privacyStatus: z.enum(["private", "public", "unlisted"]).default("private")
});
