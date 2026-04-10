import { HydratedDocument, Schema, Types, model } from "mongoose";

export interface ProjectSubtitlePreferences {
  fontFamily: string;
  fontSize: number;
  fillColor: string;
  strokeColor: string;
  highlightColor: string;
  position: "bottom_center" | "top_center";
  maxCharsPerLine: number;
  maxLines: number;
}

export const DEFAULT_PROJECT_SUBTITLE_PREFERENCES: ProjectSubtitlePreferences = {
  fontFamily: "Montserrat ExtraBold",
  fontSize: 64,
  fillColor: "#FFFFFF",
  strokeColor: "#000000",
  highlightColor: "#FFD54A",
  position: "bottom_center",
  maxCharsPerLine: 28,
  maxLines: 2
};

export interface Project {
  userId: Types.ObjectId;
  title: string;
  description?: string;
  status: "draft" | "processing" | "review" | "published" | "failed";
  workflowStage: "ingest" | "transcription" | "analysis" | "render" | "review" | "publish" | "completed";
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
      enum: ["bottom_center", "top_center"],
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
    status: {
      type: String,
      enum: ["draft", "processing", "review", "published", "failed"],
      default: "draft",
      index: true
    },
    workflowStage: {
      type: String,
      enum: ["ingest", "transcription", "analysis", "render", "review", "publish", "completed"],
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
