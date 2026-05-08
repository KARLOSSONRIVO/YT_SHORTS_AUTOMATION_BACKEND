import { HydratedDocument, Schema, Types, model } from "mongoose";

export interface Channel {
  userId: Types.ObjectId;
  provider: "youtube";
  externalChannelId: string;
  title: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  tokenExpiryDate?: Date;
  status: "connected" | "disconnected";
}

const channelSchema = new Schema<Channel>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    provider: { type: String, enum: ["youtube"], default: "youtube", index: true },
    externalChannelId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    accessToken: { type: String },
    refreshToken: { type: String },
    tokenType: { type: String },
    scope: { type: String },
    tokenExpiryDate: { type: Date },
    status: { type: String, enum: ["connected", "disconnected"], default: "connected" }
  },
  { timestamps: true }
);

channelSchema.index({ userId: 1, externalChannelId: 1 }, { unique: true });

export type ChannelDocument = HydratedDocument<Channel>;
export const ChannelModel = model<Channel>("Channel", channelSchema);
