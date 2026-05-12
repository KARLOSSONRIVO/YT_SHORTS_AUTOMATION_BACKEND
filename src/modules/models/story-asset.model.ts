import { HydratedDocument, Schema, Types, model } from "mongoose";

export type StoryAssetType =
  | "narration_audio"
  | "subtitle_srt"
  | "subtitle_ass"
  | "subtitle_json"
  | "scene_image"
  | "scene_animation"
  | "scene_ambience"
  | "scene_clip"
  | "final_video";

export interface StoryAsset {
  projectId: Types.ObjectId;
  assetType: StoryAssetType;
  sceneIndex?: number;
  prompt?: string;
  absolutePath?: string;
  storageKey?: string;
  url?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

const storyAssetSchema = new Schema<StoryAsset>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    assetType: {
      type: String,
      enum: [
        "narration_audio",
        "subtitle_srt",
        "subtitle_ass",
        "subtitle_json",
        "scene_image",
        "scene_animation",
        "scene_ambience",
        "scene_clip",
        "final_video"
      ],
      required: true,
      index: true
    },
    sceneIndex: { type: Number },
    prompt: { type: String },
    absolutePath: { type: String },
    storageKey: { type: String },
    url: { type: String },
    mimeType: { type: String },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

export type StoryAssetDocument = HydratedDocument<StoryAsset>;
export const StoryAssetModel = model<StoryAsset>("StoryAsset", storyAssetSchema);
