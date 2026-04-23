import { HydratedDocument, Schema, Types, model } from "mongoose";

export interface ProjectSubtitlePreferences {
  fontFamily: string;
  fontSize: number;
  fillColor: string;
  strokeColor: string;
  highlightColor: string;
  position: "bottom_center" | "top_center" | "middle_center";
  maxCharsPerLine: number;
  maxLines: number;
}

export interface RedditSourceMetadata {
  postId: string;
  permalink: string;
  title: string;
  body: string;
  subreddit: string;
  author?: string;
  score?: number;
  fetchedAt: Date;
}

export const DEFAULT_PROJECT_SUBTITLE_PREFERENCES: ProjectSubtitlePreferences = {
  fontFamily: "Bebas Neue",
  fontSize: 92,
  fillColor: "#FFFFFF",
  strokeColor: "#000000",
  highlightColor: "#FFD54A",
  position: "middle_center",
  maxCharsPerLine: 18,
  maxLines: 2
};

export interface Project {
  userId: Types.ObjectId;
  title: string;
  description?: string;
  hashtags?: string;
  targetClipCount?: number;
  projectType: "uploaded_video" | "faceless_story";
  facelessSource?: "topic" | "reddit_trending";
  topic?: string;
  platforms: Array<"youtube" | "tiktok">;
  targetDurationSeconds?: number;
  stylePreset?: string;
  voice?: string;
  redditSource?: RedditSourceMetadata;
  status:
    | "draft"
    | "queued"
    | "processing"
    | "writing_script"
    | "generating_audio"
    | "generating_subtitles"
    | "generating_images"
    | "animating_scenes"
    | "rendering"
    | "review"
    | "published"
    | "completed"
    | "failed";
  workflowStage:
    | "draft"
    | "ingest"
    | "transcription"
    | "analysis"
    | "script"
    | "audio"
    | "subtitles"
    | "scenes"
    | "render"
    | "review"
    | "publish"
    | "completed";
  subtitlePreferences: ProjectSubtitlePreferences;
}

const subtitlePreferencesSchema = new Schema<ProjectSubtitlePreferences>(
  {
    fontFamily: { type: String, required: true, default: DEFAULT_PROJECT_SUBTITLE_PREFERENCES.fontFamily },
    fontSize: { type: Number, required: true, default: DEFAULT_PROJECT_SUBTITLE_PREFERENCES.fontSize },
    fillColor: { type: String, required: true, default: DEFAULT_PROJECT_SUBTITLE_PREFERENCES.fillColor },
    strokeColor: { type: String, required: true, default: DEFAULT_PROJECT_SUBTITLE_PREFERENCES.strokeColor },
    highlightColor: { type: String, required: true, default: DEFAULT_PROJECT_SUBTITLE_PREFERENCES.highlightColor },
    position: {
      type: String,
      enum: ["bottom_center", "top_center", "middle_center"],
      required: true,
      default: DEFAULT_PROJECT_SUBTITLE_PREFERENCES.position
    },
    maxCharsPerLine: { type: Number, required: true, default: DEFAULT_PROJECT_SUBTITLE_PREFERENCES.maxCharsPerLine },
    maxLines: { type: Number, required: true, default: DEFAULT_PROJECT_SUBTITLE_PREFERENCES.maxLines }
  },
  { _id: false }
);

const redditSourceMetadataSchema = new Schema<RedditSourceMetadata>(
  {
    postId: { type: String, required: true, trim: true },
    permalink: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    subreddit: { type: String, required: true, trim: true },
    author: { type: String, trim: true },
    score: { type: Number },
    fetchedAt: { type: Date, required: true }
  },
  { _id: false }
);

const projectSchema = new Schema<Project>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    hashtags: { type: String, trim: true },
    targetClipCount: { type: Number, min: 1, max: 20, default: 5 },
    projectType: {
      type: String,
      enum: ["uploaded_video", "faceless_story"],
      default: "uploaded_video",
      index: true
    },
    facelessSource: {
      type: String,
      enum: ["topic", "reddit_trending"]
    },
    topic: { type: String, trim: true },
    platforms: {
      type: [String],
      enum: ["youtube", "tiktok"],
      default: ["youtube"]
    },
    targetDurationSeconds: { type: Number },
    stylePreset: { type: String, trim: true },
    voice: { type: String, trim: true },
    redditSource: { type: redditSourceMetadataSchema },
    status: {
      type: String,
      enum: [
        "draft",
        "queued",
        "processing",
        "writing_script",
        "generating_audio",
        "generating_subtitles",
        "generating_images",
        "animating_scenes",
        "rendering",
        "review",
        "published",
        "completed",
        "failed"
      ],
      default: "draft",
      index: true
    },
    workflowStage: {
      type: String,
      enum: [
        "draft",
        "ingest",
        "transcription",
        "analysis",
        "script",
        "audio",
        "subtitles",
        "scenes",
        "render",
        "review",
        "publish",
        "completed"
      ],
      default: "ingest"
    },
    subtitlePreferences: {
      type: subtitlePreferencesSchema,
      default: () => ({ ...DEFAULT_PROJECT_SUBTITLE_PREFERENCES })
    }
  },
  { timestamps: true }
);

export type ProjectDocument = HydratedDocument<Project>;
export const ProjectModel = model<Project>("Project", projectSchema);
