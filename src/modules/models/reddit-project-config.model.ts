import { HydratedDocument, Schema, Types, model } from 'mongoose';

export interface RedditProjectConfig {
  projectId: Types.ObjectId; sourceMode: 'ONE_SUBREDDIT' | 'MULTIPLE_SUBREDDITS' | 'AUTO'; subreddits: string[];
  sortMethod: 'NEW' | 'HOT' | 'TOP_TODAY' | 'TOP_WEEK' | 'RISING' | 'BEST_ELIGIBLE';
  minimumScore: number; minimumComments: number; minimumBodyLength: number; allowNSFW: boolean;
  includeComments: boolean; excludeLocked: boolean; contentFilters: string[];
  attributionMode: 'link' | 'subreddit' | 'none'; allowCrossAccountReuse: boolean;
}

const schema = new Schema<RedditProjectConfig>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true, index: true },
  sourceMode: { type: String, enum: ['ONE_SUBREDDIT', 'MULTIPLE_SUBREDDITS', 'AUTO'], required: true },
  subreddits: { type: [String], default: [] },
  sortMethod: { type: String, enum: ['NEW', 'HOT', 'TOP_TODAY', 'TOP_WEEK', 'RISING', 'BEST_ELIGIBLE'], default: 'BEST_ELIGIBLE' },
  minimumScore: { type: Number, default: 50, min: 0 }, minimumComments: { type: Number, default: 10, min: 0 },
  minimumBodyLength: { type: Number, default: 300, min: 80 }, allowNSFW: { type: Boolean, default: false },
  includeComments: { type: Boolean, default: false }, excludeLocked: { type: Boolean, default: true },
  contentFilters: { type: [String], default: [] }, attributionMode: { type: String, enum: ['link', 'subreddit', 'none'], default: 'link' },
  allowCrossAccountReuse: { type: Boolean, default: false }
}, { timestamps: true });

export type RedditProjectConfigDocument = HydratedDocument<RedditProjectConfig>;
export const RedditProjectConfigModel = model<RedditProjectConfig>('RedditProjectConfig', schema);
