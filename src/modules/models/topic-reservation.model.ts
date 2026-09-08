import { HydratedDocument, Schema, Types, model } from "mongoose";

export type TopicReservationRole = "current" | "next";

export interface TopicReservation {
  projectId: Types.ObjectId;
  accountId: Types.ObjectId;
  nicheId: string;
  scheduledDate: string;
  role: TopicReservationRole;
  generationIdempotencyKey: string;
  topic: string;
  title: string;
  normalizedTopic: string;
  normalizedTitle: string;
}

const schema = new Schema<TopicReservation>({
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  accountId: { type: Schema.Types.ObjectId, ref: "Channel", required: true, index: true },
  nicheId: { type: String, required: true, index: true },
  scheduledDate: { type: String, required: true },
  role: { type: String, enum: ["current", "next"], required: true },
  generationIdempotencyKey: { type: String, required: true, index: true },
  topic: { type: String, required: true },
  title: { type: String, required: true },
  normalizedTopic: { type: String, required: true },
  normalizedTitle: { type: String, required: true }
}, { timestamps: true });

schema.index({ accountId: 1, nicheId: 1, normalizedTopic: 1 }, { unique: true });
schema.index({ accountId: 1, nicheId: 1, normalizedTitle: 1 }, { unique: true });
schema.index({ accountId: 1, nicheId: 1, scheduledDate: 1 });

export type TopicReservationDocument = HydratedDocument<TopicReservation>;
export const TopicReservationModel = model<TopicReservation>("TopicReservation", schema);
