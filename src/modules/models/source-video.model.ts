import { HydratedDocument, Schema, Types, model } from "mongoose";

export interface SourceVideo {
  projectId: Types.ObjectId;
  originalFileName: string;
  mimeType: string;
  storageKey: string;
  sizeBytes: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  status: "uploaded" | "processing" | "processed" | "failed";
}

const sourceVideoSchema = new Schema<SourceVideo>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    originalFileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    storageKey: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    durationSeconds: { type: Number },
    width: { type: Number },
    height: { type: Number },
    status: {
      type: String,
      enum: ["uploaded", "processing", "processed", "failed"],
      default: "uploaded"
    }
  },
  { timestamps: true }
);

export type SourceVideoDocument = HydratedDocument<SourceVideo>;
export const SourceVideoModel = model<SourceVideo>("SourceVideo", sourceVideoSchema);
