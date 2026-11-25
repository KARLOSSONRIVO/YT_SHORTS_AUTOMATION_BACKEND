import { HydratedDocument, Schema, Types, model } from "mongoose";

import type { CaptionPlacement, VerticalLayout } from "../validators/clip.validator";
import { CAPTION_FONT_SIZE, CAPTION_PRESETS, type CaptionPreset } from "./project.model";

export interface Clip {
  captionPlacement?: CaptionPlacement;
  captionPreset?: CaptionPreset;
  captionFontSize?: number;
  verticalLayout?: VerticalLayout;
  projectId: Types.ObjectId;
  sourceVideoId: Types.ObjectId;
  transcriptId?: Types.ObjectId;
  title: string;
  hashtags?: string;
  description?: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  rangeEdited?: boolean;
  score: number;
  reviewStatus: "pending_review" | "approved" | "rejected";
  renderStatus: "queued" | "rendering" | "rendered" | "failed";
  publishStatus: "not_ready" | "queued" | "published" | "failed";
  outputStorageKey?: string;
  subtitleStorageKey?: string;
  analysisReason?: string;
  publishedAt?: Date;
}

const clipSchema = new Schema<Clip>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    sourceVideoId: { type: Schema.Types.ObjectId, ref: "SourceVideo", required: true, index: true },
    transcriptId: { type: Schema.Types.ObjectId, ref: "Transcript" },
    title: { type: String, required: true, trim: true },
    hashtags: { type: String, trim: true },
    description: { type: String, trim: true },
    startTimeSeconds: { type: Number, required: true },
    endTimeSeconds: { type: Number, required: true },
    durationSeconds: { type: Number, required: true },
    rangeEdited: { type: Boolean },
    captionPlacement: { type: new Schema<CaptionPlacement>({ x: Number, y: Number }, { _id: false }) },
    captionPreset: { type: String, enum: CAPTION_PRESETS },
    captionFontSize: { type: Number, min: CAPTION_FONT_SIZE.min, max: CAPTION_FONT_SIZE.max },
    score: { type: Number, required: true, default: 0 },
    reviewStatus: {
      type: String,
      enum: ["pending_review", "approved", "rejected"],
      default: "pending_review",
      index: true
    },
    renderStatus: { type: String, enum: ["queued", "rendering", "rendered", "failed"], default: "queued" },
    publishStatus: { type: String, enum: ["not_ready", "queued", "published", "failed"], default: "not_ready" },
    verticalLayout: { type: Schema.Types.Mixed },
    outputStorageKey: { type: String },
    subtitleStorageKey: { type: String },
    analysisReason: { type: String },
    publishedAt: { type: Date }
  },
  { timestamps: true }
);

export type ClipDocument = HydratedDocument<Clip>;
export const ClipModel = model<Clip>("Clip", clipSchema);
