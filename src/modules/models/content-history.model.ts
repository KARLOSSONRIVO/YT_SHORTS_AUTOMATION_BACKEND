import { HydratedDocument, Schema, Types, model } from "mongoose";

export type ContentStatus = "queued" | "researching" | "writing" | "generating_voice" | "generating_visuals" | "rendering" | "quality_check" | "awaiting_approval" | "scheduled" | "uploading" | "uploaded" | "draft" | "rejected" | "failed";
export interface ContentHistory {
  userId: Types.ObjectId; projectId: Types.ObjectId; renderProjectId?: Types.ObjectId; legacyAutomationId?: Types.ObjectId; nicheId: string; accountId: Types.ObjectId;
  topic: string; normalizedTopic: string; title: string; projectTitle?: string; description?: string; script?: string; summary: string;
  hook?: string; importantEntities: string[]; dates: string[]; events: string[]; keywords: string[]; sourceLinks: string[];
  storyAngle: string; storyFormat: string; tone: string; targetAudience: string[]; visualStyle: string; voiceId: string;
  fallbackVoiceId?: string; language: string; region: string; targetDurationSeconds: number; estimatedDurationSeconds?: number;
  contentEmbedding: number[]; scriptFingerprint?: string; status: ContentStatus; rejectionReasons?: string[]; qc?: Record<string, unknown>;
  scheduledUploadTime?: Date; uploadDate?: Date; platformVideoId?: string; platformUrl?: string; platform: string;
  generationIdempotencyKey: string; uploadIdempotencyKey: string; uploadAttempts: number; generationAttempts: number; lastError?: string; metadata?: Record<string, unknown>;
  nextRetryAt?: Date;
}
const schema = new Schema<ContentHistory>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true }, renderProjectId: { type: Schema.Types.ObjectId, ref: "Project", index: true },
  legacyAutomationId: { type: Schema.Types.ObjectId, index: true }, nicheId: { type: String, required: true, index: true }, accountId: { type: Schema.Types.ObjectId, ref: "Channel", required: true, index: true },
  topic: { type: String, required: true }, normalizedTopic: { type: String, required: true, index: true }, title: { type: String, required: true }, projectTitle: String,
  description: String, script: String, summary: { type: String, required: true }, hook: String, importantEntities: [String], dates: [String], events: [String], keywords: [String],
  sourceLinks: [String], storyAngle: { type: String, required: true }, storyFormat: { type: String, required: true }, tone: { type: String, required: true }, targetAudience: [String],
  visualStyle: String, voiceId: String, fallbackVoiceId: String, language: String, region: String, targetDurationSeconds: Number, estimatedDurationSeconds: Number,
  contentEmbedding: [Number], scriptFingerprint: String, status: { type: String, enum: ["queued","researching","writing","generating_voice","generating_visuals","rendering","quality_check","awaiting_approval","scheduled","uploading","uploaded","draft","rejected","failed"], index: true },
  rejectionReasons: [String], qc: Schema.Types.Mixed, scheduledUploadTime: Date, uploadDate: Date, platformVideoId: String, platformUrl: String, platform: String,
  generationIdempotencyKey: { type: String, required: true, unique: true }, uploadIdempotencyKey: { type: String, required: true, unique: true },
  uploadAttempts: { type: Number, default: 0 }, generationAttempts: { type: Number, default: 0 }, lastError: String, metadata: Schema.Types.Mixed
  ,nextRetryAt: { type: Date, index: true }
}, { timestamps: true });
schema.index({ nicheId: 1, accountId: 1, uploadDate: -1 });
schema.index({ nicheId: 1, importantEntities: 1 });
schema.index({ projectId: 1, createdAt: -1 });
schema.index({ projectId: 1, scheduledUploadTime: 1 });
schema.index({ projectId: 1, status: 1 });
schema.index({ platformVideoId: 1 }, { unique: true, sparse: true });
export type ContentHistoryDocument = HydratedDocument<ContentHistory>;
export const ContentHistoryModel = model<ContentHistory>("ContentHistory", schema);
