export const QUEUE_NAMES = {
  INGEST: "ingest",
  TRANSCRIPTION: "transcription",
  ANALYSIS: "analysis",
  STORY: "story",
  RENDER: "render",
  UPLOAD: "upload",
  AUTOMATION: "automation"
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
