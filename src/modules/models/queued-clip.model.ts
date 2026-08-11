import { HydratedDocument, Schema, Types, model } from 'mongoose';

export interface QueuedClip {
  projectId: Types.ObjectId; accountId: Types.ObjectId; sourceFile: string; sourceFileHash: string;
  thumbnailFile?: string; subtitleFile?: string; title: string; description?: string; hashtags: string[]; language: string;
  scheduledAt?: Date; status: 'pending' | 'scheduled' | 'uploading' | 'uploaded' | 'failed' | 'draft';
  privacyStatus: 'private' | 'public' | 'unlisted'; audienceSetting: 'not_made_for_kids' | 'made_for_kids';
  platformVideoId?: string; uploadedAt?: Date; error?: string; queuePosition: number;
  durationSeconds: number; width?: number; height?: number; hasAudio: boolean; uploadIdempotencyKey: string;
}

const schema = new Schema<QueuedClip>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  accountId: { type: Schema.Types.ObjectId, ref: 'Channel', required: true, index: true },
  sourceFile: { type: String, required: true }, sourceFileHash: { type: String, required: true }, thumbnailFile: String, subtitleFile: String,
  title: { type: String, required: true }, description: String, hashtags: { type: [String], default: [] },
  language: { type: String, default: 'en' }, scheduledAt: { type: Date, index: true },
  status: { type: String, enum: ['pending', 'scheduled', 'uploading', 'uploaded', 'failed', 'draft'], default: 'pending', index: true },
  privacyStatus: { type: String, enum: ['private', 'public', 'unlisted'], default: 'private' },
  audienceSetting: { type: String, enum: ['not_made_for_kids', 'made_for_kids'], default: 'not_made_for_kids' },
  platformVideoId: { type: String, unique: true, sparse: true }, uploadedAt: Date, error: String,
  queuePosition: { type: Number, required: true, min: 0 }, durationSeconds: { type: Number, required: true },
  width: Number, height: Number, hasAudio: { type: Boolean, required: true },
  uploadIdempotencyKey: { type: String, required: true, unique: true, index: true }
}, { timestamps: true });

schema.index({ sourceFileHash: 1, accountId: 1 }, { unique: true });
schema.index({ projectId: 1, status: 1, queuePosition: 1 });
schema.index({ status: 1, scheduledAt: 1 });
export type QueuedClipDocument = HydratedDocument<QueuedClip>;
export const QueuedClipModel = model<QueuedClip>('QueuedClip', schema);
