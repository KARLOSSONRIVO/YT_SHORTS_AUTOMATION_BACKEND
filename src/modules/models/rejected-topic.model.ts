import { HydratedDocument, Schema, Types, model } from "mongoose";
export interface RejectedTopic { userId: Types.ObjectId; projectId: Types.ObjectId; nicheId: string; topic: string; title: string; reasons: string[]; similarityScore?: number; matchedContentId?: Types.ObjectId; }
const schema = new Schema<RejectedTopic>({ userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true }, projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true }, nicheId: { type: String, required: true, index: true }, topic: String, title: String, reasons: [String], similarityScore: Number, matchedContentId: { type: Schema.Types.ObjectId, ref: "ContentHistory" } }, { timestamps: true });
schema.index({ projectId: 1, createdAt: -1 });
export type RejectedTopicDocument = HydratedDocument<RejectedTopic>;
export const RejectedTopicModel = model<RejectedTopic>("RejectedTopic", schema);
