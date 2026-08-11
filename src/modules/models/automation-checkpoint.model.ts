import { Schema, model } from "mongoose";
import type { TopicCandidate } from "../automation/automation.types";

export interface AutomationCheckpoint {
  projectId: string;
  scheduledDate: string;
  researchCandidates?: TopicCandidate[];
}

const schema = new Schema<AutomationCheckpoint>({
  projectId: { type: String, required: true },
  scheduledDate: { type: String, required: true },
  researchCandidates: { type: [Schema.Types.Mixed], default: undefined }
}, { timestamps: true });

schema.index({ projectId: 1, scheduledDate: 1 }, { unique: true });
export const AutomationCheckpointModel = model<AutomationCheckpoint>("AutomationCheckpoint", schema);
