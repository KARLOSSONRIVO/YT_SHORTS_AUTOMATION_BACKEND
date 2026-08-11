import { HydratedDocument, Schema, Types, model } from 'mongoose';

export interface RedditSourceRecord {
  redditPostId: string; subreddit: string; permalink: string; authorHash?: string; sourceCreatedAt: Date;
  fetchedAt: Date; originalTitle: string; contentHash: string; generatedTitle?: string; generatedScript?: string;
  summary?: string; entities: string[]; storyAngle?: string; embedding?: number[]; projectId: Types.ObjectId;
  storyId?: Types.ObjectId; accountId: Types.ObjectId;
  status: 'selected' | 'rejected' | 'transformed' | 'uploaded' | 'failed';
  rejectionReason?: string; uploadStatus?: string; youtubeVideoId?: string;
}

const schema = new Schema<RedditSourceRecord>({
  redditPostId: { type: String, required: true, unique: true, index: true },
  subreddit: { type: String, required: true, index: true },
  permalink: { type: String, required: true, unique: true, index: true }, authorHash: String,
  sourceCreatedAt: { type: Date, required: true }, fetchedAt: { type: Date, required: true },
  originalTitle: { type: String, required: true }, contentHash: { type: String, required: true, unique: true, index: true },
  generatedTitle: String, generatedScript: String, summary: String, entities: { type: [String], default: [] },
  storyAngle: String, embedding: [Number],
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  storyId: { type: Schema.Types.ObjectId, ref: 'ContentHistory', index: true },
  accountId: { type: Schema.Types.ObjectId, ref: 'Channel', required: true, index: true },
  status: { type: String, enum: ['selected', 'rejected', 'transformed', 'uploaded', 'failed'], required: true, index: true },
  rejectionReason: String, uploadStatus: String, youtubeVideoId: { type: String, unique: true, sparse: true }
}, { timestamps: true });

schema.index({ projectId: 1, fetchedAt: -1 });
schema.index({ accountId: 1, status: 1 });
export type RedditSourceDocument = HydratedDocument<RedditSourceRecord>;
export const RedditSourceModel = model<RedditSourceRecord>('RedditSource', schema);
