import { z } from "zod";
import { CAPTION_FONT_SIZE, CAPTION_PRESETS } from "../models/project.model";

export const listClipsQuerySchema = z.object({
  projectId: z.string().min(1)
});

export const clipIdParamsSchema = z.object({
  clipId: z.string().min(1)
});

const cropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.01).max(1),
  height: z.number().min(0.01).max(1)
}).refine((crop) => crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001);

export const verticalLayoutSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("gameplay"), gameplay: cropSchema }),
  z.object({ mode: z.literal("split"), gameplay: cropSchema, camera: cropSchema }),
  z.object({ mode: z.literal("facecam"), gameplay: cropSchema, camera: cropSchema })
]);

export type VerticalLayout = z.infer<typeof verticalLayoutSchema>;

const clipRangeSchema = z.object({
  startTimeSeconds: z.number().finite().nonnegative(),
  endTimeSeconds: z.number().finite().positive()
}).refine(({ startTimeSeconds, endTimeSeconds }) =>
  endTimeSeconds - startTimeSeconds >= 0.1 - 1e-9,
  { message: "The clip must be at least 0.1 seconds long." }
);

export type ClipRange = z.infer<typeof clipRangeSchema>;

const captionPlacementSchema = z.object({
  x: z.number().finite().min(0.05).max(0.95),
  y: z.number().finite().min(0.05).max(0.95)
});

export type CaptionPlacement = z.infer<typeof captionPlacementSchema>;

export const reviewClipBodySchema = z.object({
  reviewStatus: z.enum(["approved", "rejected"]),
  verticalLayout: verticalLayoutSchema.optional(),
  clipRange: clipRangeSchema.optional(),
  captionPlacement: captionPlacementSchema.optional(),
  captionPreset: z.enum(CAPTION_PRESETS).optional(),
  captionFontSize: z.number().int().min(CAPTION_FONT_SIZE.min).max(CAPTION_FONT_SIZE.max).optional()
}).refine(({ reviewStatus, clipRange, captionPlacement, captionPreset, captionFontSize }) =>
  reviewStatus === "approved" || (!clipRange && !captionPlacement && !captionPreset && captionFontSize === undefined),
  { message: "Clip range and caption edits can be saved only when approving a clip." }
);
