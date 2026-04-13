import { HydratedDocument, Schema, Types, model } from "mongoose";

export interface StoryScene {
  sceneIndex: number;
  narration: string;
  imagePrompt: string;
  durationSeconds: number;
  captionText: string;
}

export interface StoryScript {
  projectId: Types.ObjectId;
  title: string;
  hook: string;
  narration: string;
  captionText: string;
  imagePrompts: string[];
  scenes: StoryScene[];
}

const storySceneSchema = new Schema<StoryScene>(
  {
    sceneIndex: { type: Number, required: true },
    narration: { type: String, required: true },
    imagePrompt: { type: String, required: true },
    durationSeconds: { type: Number, required: true },
    captionText: { type: String, required: true }
  },
  { _id: false }
);

const storyScriptSchema = new Schema<StoryScript>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    hook: { type: String, required: true },
    narration: { type: String, required: true },
    captionText: { type: String, required: true },
    imagePrompts: { type: [String], default: [] },
    scenes: { type: [storySceneSchema], default: [] }
  },
  { timestamps: true }
);

export type StoryScriptDocument = HydratedDocument<StoryScript>;
export const StoryScriptModel = model<StoryScript>("StoryScript", storyScriptSchema);
