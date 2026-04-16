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

export const DEFAULT_PROJECT_SUBTITLE_PREFERENCES: ProjectSubtitlePreferences = {
  fontFamily: "Bebas Neue",
  fontSize: 92,
  fillColor: "#FFFFFF",
  strokeColor: "#000000",
  highlightColor: "#FFFFFF",
  position: "middle_center",
  maxCharsPerLine: 18,
  maxLines: 2
};

export interface Project {
  userId: Types.ObjectId;
  title: string;
  description?: string;
  projectType: "uploaded_video" | "faceless_story";
  topic?: string;
  platforms: Array<"youtube" | "tiktok">;
  targetDurationSeconds?: number;
  stylePreset?: string;
  voice?: string;
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

const projectSchema = new Schema<Project>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    projectType: {
      type: String,
      enum: ["uploaded_video", "faceless_story"],
      default: "uploaded_video",
      index: true
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
