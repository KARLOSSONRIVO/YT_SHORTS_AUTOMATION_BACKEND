import { HydratedDocument, Schema, Types, model } from "mongoose";
import { QUEUE_NAMES } from "../../infrastructure/queue/queue.names";

export interface Job {
  projectId: Types.ObjectId;
  clipId?: Types.ObjectId;
  queueName: (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
  type: string;
  status: "queued" | "active" | "completed" | "failed";
  attempts: number;
  externalJobId?: string;
  payload: Record<string, unknown>;
  progress?: {
    total?: number;
    current?: number;
    percent?: number;
    message?: string;
    currentSceneIndex?: number;
    completedScenes?: number[];
  };
  result?: Record<string, unknown>;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
}

const jobSchema = new Schema<Job>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    clipId: { type: Schema.Types.ObjectId, ref: "Clip" },
    queueName: { type: String, enum: Object.values(QUEUE_NAMES), required: true },
    type: { type: String, required: true },
    status: { type: String, enum: ["queued", "active", "completed", "failed"], default: "queued", index: true },
    attempts: { type: Number, default: 0 },
    externalJobId: { type: String },
    payload: { type: Schema.Types.Mixed, required: true },
    progress: { type: Schema.Types.Mixed },
    result: { type: Schema.Types.Mixed },
    errorMessage: { type: String },
    startedAt: { type: Date },
    completedAt: { type: Date }
  },
  { timestamps: true }
);

export type JobDocument = HydratedDocument<Job>;
export const JobModel = model<Job>("Job", jobSchema);
