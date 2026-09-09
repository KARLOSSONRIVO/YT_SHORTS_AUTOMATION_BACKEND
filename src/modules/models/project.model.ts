import { HydratedDocument, Schema, Types, model } from "mongoose";
import { AUTOMATION_MODES, CONTENT_TYPES, SCRIPT_FRAMEWORKS, STORY_FORMATS, VISUAL_TYPES, type AutomationMode, type ContentType, type ScriptFramework, type SerializedStoryAssignment, type SerializedStoryState, type StoryFormat, type VisualType } from "../automation/automation.types";

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
  highlightColor: "#FFD54A",
  position: "middle_center",
  maxCharsPerLine: 18,
  maxLines: 2
};

export interface Project {
  userId: Types.ObjectId;
  title: string;
  name?: string;
  description?: string;
  hashtags?: string;
  targetClipCount?: number;
  projectType: "uploaded_video" | "faceless_story";
  contentType: ContentType;
  visualType?: VisualType;
  facelessSource?: "daily_automation" | "archived_legacy";
  legacySource?: string;
  parentProjectId?: Types.ObjectId;
  internalStory?: boolean;
  archivedLegacy?: boolean;
  legacyAutomationId?: Types.ObjectId;
  nicheId?: string;
  accountId?: Types.ObjectId;
  timezone?: string;
  uploadTime?: string;
  durationSeconds?: number;
  storyFormatMode?: "auto_select" | "manual_select" | "selected_formats";
  manualStoryFormat?: StoryFormat;
  allowedStoryFormats?: StoryFormat[];
  automationMode?: AutomationMode;
  automationEnabled?: boolean;
  automationStatus?: "active" | "paused" | "running" | "error";
  nextRunAt?: Date;
  lastRunAt?: Date;
  lastSuccessfulGenerationAt?: Date;
  lastUploadAt?: Date;
  topic?: string;
  sourceText?: string;
  experimentVariant?: string;
  nextStoryTitle?: string;
  nextStoryTopic?: string;
  platforms: Array<"youtube" | "tiktok">;
  targetDurationSeconds?: number;
  stylePreset?: string;
  scriptFramework?: ScriptFramework;
  serializedStory?: SerializedStoryState;
  serializedStoryAssignment?: SerializedStoryAssignment;
  facelessRenderMode?: "image_story" | "animation_story" | "background_video";
  voice?: string;
  tone?: string;
  audience?: string;
  language?: string;
  storyFormat?: string;
  speakingRate?: number;
  fallbackVoice?: string;
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
    | "animations"
    | "ambience"
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

const serializedStoryStateSchema = new Schema<SerializedStoryState>(
  {
    episodesPerSeries: { type: Number, required: true, min: 1, max: 12 },
    nextSeriesNumber: { type: Number, required: true, min: 1, default: 1 },
    nextEpisodeNumber: { type: Number, required: true, min: 1, default: 1 },
    seriesTitle: { type: String, trim: true },
    premise: { type: String, trim: true },
    setting: { type: String, trim: true },
    characterNotes: { type: String, trim: true },
    lastEpisodeSummary: { type: String, trim: true },
    queuedEpisodeTitle: { type: String, trim: true },
    queuedEpisodeTopic: { type: String, trim: true },
    queuedEpisodePromise: { type: String, trim: true }
  },
  { _id: false }
);

const serializedStoryAssignmentSchema = new Schema<SerializedStoryAssignment>(
  {
    seriesNumber: { type: Number, required: true, min: 1 },
    episodeNumber: { type: Number, required: true, min: 1 },
    episodesPerSeries: { type: Number, required: true, min: 1, max: 12 },
    seriesTitle: { type: String, required: true, trim: true },
    premise: { type: String, required: true, trim: true },
    setting: { type: String, required: true, trim: true },
    characterNotes: { type: String, required: true, trim: true },
    episodeObjective: { type: String, required: true, trim: true },
    episodeSummary: { type: String, required: true, trim: true },
    nextEpisodeTitle: { type: String, trim: true },
    nextEpisodeTopic: { type: String, trim: true },
    nextEpisodePromise: { type: String, trim: true }
  },
  { _id: false }
);

const projectSchema = new Schema<Project>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true },
    name: { type: String, trim: true },
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
      enum: ["daily_automation", "archived_legacy"]
    },
    contentType: { type: String, enum: CONTENT_TYPES, required: true, default: "FACELESS_NICHE", index: true },
    visualType: { type: String, enum: VISUAL_TYPES, default: "AUTO" },
    legacySource: { type: String, trim: true },
    parentProjectId: { type: Schema.Types.ObjectId, ref: "Project", index: true },
    internalStory: { type: Boolean, default: false, index: true },
    archivedLegacy: { type: Boolean, default: false, index: true },
    legacyAutomationId: { type: Schema.Types.ObjectId, index: true, unique: true, sparse: true },
    nicheId: { type: String, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: "Channel", index: true },
    timezone: { type: String, trim: true },
    uploadTime: { type: String, trim: true },
    durationSeconds: { type: Number, default: 60, min: 15, max: 180 },
    storyFormatMode: { type: String, enum: ["auto_select", "manual_select", "selected_formats"], default: "auto_select" },
    manualStoryFormat: { type: String, enum: STORY_FORMATS },
    allowedStoryFormats: [{ type: String, enum: STORY_FORMATS }],
    automationMode: { type: String, enum: AUTOMATION_MODES, default: "approval_before_upload" },
    automationEnabled: { type: Boolean, default: false, index: true },
    automationStatus: { type: String, enum: ["active", "paused", "running", "error"], default: "paused", index: true },
    nextRunAt: { type: Date, index: true },
    lastRunAt: Date,
    lastSuccessfulGenerationAt: Date,
    lastUploadAt: Date,
    topic: { type: String, trim: true },
    sourceText: { type: String, trim: true },
    experimentVariant: { type: String, trim: true },
    nextStoryTitle: { type: String, trim: true },
    nextStoryTopic: { type: String, trim: true },
    platforms: {
      type: [String],
      enum: ["youtube", "tiktok"],
      default: ["youtube"]
    },
    targetDurationSeconds: { type: Number },
    stylePreset: { type: String, trim: true },
    scriptFramework: {
      type: String,
      enum: SCRIPT_FRAMEWORKS,
      default: "psychology_truth"
    },
    serializedStory: { type: serializedStoryStateSchema },
    serializedStoryAssignment: { type: serializedStoryAssignmentSchema },
    facelessRenderMode: {
      type: String,
      enum: ["image_story", "animation_story", "background_video"],
      default: "image_story"
    },
    voice: { type: String, trim: true },
    tone: { type: String, trim: true },
    audience: { type: String, trim: true },
    language: { type: String, trim: true, default: "en" },
    storyFormat: { type: String, trim: true },
    speakingRate: { type: Number, min: 0.5, max: 2 },
    fallbackVoice: { type: String, trim: true },
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
        "animations",
        "ambience",
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

projectSchema.index({ userId: 1, internalStory: 1, createdAt: -1 });
projectSchema.index({ automationEnabled: 1, nextRunAt: 1 });
projectSchema.index({ accountId: 1, automationEnabled: 1 });
projectSchema.index({ contentType: 1, automationStatus: 1, nextRunAt: 1 });

export type ProjectDocument = HydratedDocument<Project>;
export const ProjectModel = model<Project>("Project", projectSchema);
