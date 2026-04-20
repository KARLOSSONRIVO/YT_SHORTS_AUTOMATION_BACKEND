import { HydratedDocument, Schema, Types, model } from "mongoose";

export interface UploadHistory {
  clipId?: Types.ObjectId;
  projectId?: Types.ObjectId;
  channelId: Types.ObjectId;
  youtubeVideoId?: string;
  title: string;
  description?: string;
  privacyStatus: "private" | "public" | "unlisted";
  status: "queued" | "uploaded" | "failed";
  uploadedAt?: Date;
  failureReason?: string;
  responseSnapshot?: Record<string, unknown>;
}

const uploadHistorySchema = new Schema<UploadHistory>(
  {
    clipId: { type: Schema.Types.ObjectId, ref: "Clip", index: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", index: true },
    channelId: { type: Schema.Types.ObjectId, ref: "Channel", required: true, index: true },
    youtubeVideoId: { type: String },
    title: { type: String, required: true },
    description: { type: String },
    privacyStatus: { type: String, enum: ["private", "public", "unlisted"], default: "private" },
    status: { type: String, enum: ["queued", "uploaded", "failed"], default: "queued" },
    uploadedAt: { type: Date },
    failureReason: { type: String },
    responseSnapshot: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

export type UploadHistoryDocument = HydratedDocument<UploadHistory>;
export const UploadHistoryModel = model<UploadHistory>("UploadHistory", uploadHistorySchema);
