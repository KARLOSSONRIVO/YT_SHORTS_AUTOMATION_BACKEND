import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a hex color like #FFFFFF");

export const createUploadBodySchema = z.object({
  userId: z.string().min(1),
  title: z.string().min(3).max(160),
  description: z.string().max(5000).optional(),
  hashtags: z.string().max(300).optional(),
  targetClipCount: z.coerce.number().int().min(1).max(20).optional(),
  fontFamily: z.string().min(1).max(120).optional(),
  fontSize: z.coerce.number().int().min(24).max(120).optional(),
  fillColor: hexColor.optional(),
  strokeColor: hexColor.optional(),
  highlightColor: hexColor.optional(),
  position: z.enum(["bottom_center", "top_center"]).optional(),
  maxCharsPerLine: z.coerce.number().int().min(12).max(42).optional(),
  maxLines: z.coerce.number().int().min(1).max(4).optional()
});
