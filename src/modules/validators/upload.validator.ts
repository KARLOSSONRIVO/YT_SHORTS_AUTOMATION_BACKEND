import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a hex color like #FFFFFF");

export const isYouTubeSourceUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return hostname === "youtube.com" || hostname === "m.youtube.com" || hostname === "youtu.be" || hostname.endsWith(".youtube.com");
  } catch {
    return false;
  }
};

const subtitlePreferencesSchema = z.object({
  fontFamily: z.string().min(1).max(120),
  fontSize: z.coerce.number().int().min(24).max(120),
  fillColor: hexColor,
  strokeColor: hexColor,
  highlightColor: hexColor,
  position: z.enum(["bottom_center", "top_center", "middle_center"]),
  maxCharsPerLine: z.coerce.number().int().min(12).max(42),
  maxLines: z.coerce.number().int().min(1).max(4)
});

export const createUploadBodySchema = z.object({
  title: z.string().min(3).max(160),
  description: z.string().max(5000).optional(),
  hashtags: z.string().max(300).optional(),
  targetClipCount: z.coerce.number().int().min(1).max(20).optional(),
  fontFamily: z.string().min(1).max(120).optional(),
  fontSize: z.coerce.number().int().min(24).max(120).optional(),
  fillColor: hexColor.optional(),
  strokeColor: hexColor.optional(),
  highlightColor: hexColor.optional(),
  position: z.enum(["bottom_center", "top_center", "middle_center"]).optional(),
  maxCharsPerLine: z.coerce.number().int().min(12).max(42).optional(),
  maxLines: z.coerce.number().int().min(1).max(4).optional()
});

export const createYouTubeSourceBodySchema = z.object({
  sourceUrl: z.string().trim().url("Enter a valid YouTube video link.").refine(isYouTubeSourceUrl, "Use a YouTube video link."),
  title: z.string().trim().min(3).max(160),
  description: z.string().max(5000).optional(),
  hashtags: z.string().max(300).optional(),
  targetClipCount: z.coerce.number().int().min(1).max(20).optional(),
  language: z.string().trim().min(2).max(12).optional(),
  subtitlePreferences: subtitlePreferencesSchema.optional()
});
