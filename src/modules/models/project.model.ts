import { HydratedDocument, Schema, Types, model } from "mongoose";

export interface Project {
  userId: Types.ObjectId;
  title: string;
  description?: string;
  status: "draft" | "processing" | "review" | "published" | "failed";
  workflowStage: "ingest" | "transcription" | "analysis" | "render" | "review" | "publish" | "completed";
}

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
    }
  },
  { timestamps: true }
);

export type ProjectDocument = HydratedDocument<Project>;
export const ProjectModel = model<Project>("Project", projectSchema);
