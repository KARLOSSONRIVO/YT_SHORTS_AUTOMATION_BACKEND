import { HydratedDocument, Schema, Types, model } from "mongoose";

export interface TranscriptWord {
  startTimeSeconds: number;
  endTimeSeconds: number;
  word: string;
  probability?: number;
}

export interface TranscriptSegment {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  words: TranscriptWord[];
}

export interface Transcript {
  projectId: Types.ObjectId;
  sourceVideoId: Types.ObjectId;
  language: string;
  rawText: string;
  segments: TranscriptSegment[];
  provider: string;
  status: "pending" | "completed" | "failed";
}

const transcriptWordSchema = new Schema<TranscriptWord>(
  {
    startTimeSeconds: { type: Number, required: true },
    endTimeSeconds: { type: Number, required: true },
    word: { type: String, required: true },
    probability: { type: Number }
  },
  { _id: false }
);

const transcriptSegmentSchema = new Schema<TranscriptSegment>(
  {
    startTimeSeconds: { type: Number, required: true },
    endTimeSeconds: { type: Number, required: true },
    text: { type: String, required: true },
    words: { type: [transcriptWordSchema], default: [] }
  },
  { _id: false }
);

const transcriptSchema = new Schema<Transcript>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    sourceVideoId: { type: Schema.Types.ObjectId, ref: "SourceVideo", required: true, index: true },
    language: { type: String, required: true, default: "en" },
    rawText: { type: String, required: true },
    segments: { type: [transcriptSegmentSchema], default: [] },
    provider: { type: String, required: true, default: "python-worker" },
    status: { type: String, enum: ["pending", "completed", "failed"], default: "completed" }
  },
  { timestamps: true }
);

export type TranscriptDocument = HydratedDocument<Transcript>;
export const TranscriptModel = model<Transcript>("Transcript", transcriptSchema);
