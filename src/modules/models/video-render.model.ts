import { HydratedDocument, Schema, Types, model } from "mongoose";

export interface VideoRender {
  projectId: Types.ObjectId;
  status: "queued" | "rendering" | "completed" | "failed";
  videoPath?: string;
  videoUrl?: string;
  durationSeconds?: number;
  errorMessage?: string;
  completedAt?: Date;
}

const videoRenderSchema = new Schema<VideoRender>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["queued", "rendering", "completed", "failed"],
      default: "queued",
      index: true
    },
    videoPath: { type: String },
    videoUrl: { type: String },
    durationSeconds: { type: Number },
    errorMessage: { type: String },
    completedAt: { type: Date }
  },
  { timestamps: true }
);

export type VideoRenderDocument = HydratedDocument<VideoRender>;
export const VideoRenderModel = model<VideoRender>("VideoRender", videoRenderSchema);
