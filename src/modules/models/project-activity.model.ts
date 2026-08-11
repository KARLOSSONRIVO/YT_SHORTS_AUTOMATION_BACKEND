import { HydratedDocument, Schema, Types, model } from "mongoose";

export interface ProjectActivity {
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  type: string;
  message: string;
  severity: "info" | "warning" | "error";
  metadata?: Record<string, unknown>;
}

const schema = new Schema<ProjectActivity>({
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, required: true, index: true },
  message: { type: String, required: true },
  severity: { type: String, enum: ["info", "warning", "error"], default: "info" },
  metadata: Schema.Types.Mixed
}, { timestamps: true });

schema.index({ projectId: 1, createdAt: -1 });
export type ProjectActivityDocument = HydratedDocument<ProjectActivity>;
export const ProjectActivityModel = model<ProjectActivity>("ProjectActivity", schema);
