import type { JobsOptions } from "bullmq";
import { QUEUE_NAMES } from "../../../infrastructure/queue/queue.names";
import type { QueueRegistry } from "../../../infrastructure/queue/queues";

export class QueueService {
  constructor(private readonly queues: QueueRegistry) {}

  private add(queueName: keyof typeof QUEUE_NAMES, name: string, payload: Record<string, unknown>, options?: JobsOptions) {
    return this.queues[QUEUE_NAMES[queueName]].add(name, payload, options);
  }

  public addIngestJob(payload: Record<string, unknown>) {
    return this.add("INGEST", "video.ingest.requested", payload);
  }

  public addTranscriptionJob(payload: Record<string, unknown>) {
    return this.add("TRANSCRIPTION", "video.transcription.requested", payload);
  }

  public addAnalysisJob(payload: Record<string, unknown>) {
    return this.add("ANALYSIS", "video.analysis.requested", payload);
  }

  public addRenderJob(payload: Record<string, unknown>) {
    return this.add("RENDER", "clip.render.requested", payload);
  }

  public addUploadJob(payload: Record<string, unknown>) {
    return this.add("UPLOAD", "clip.upload.requested", payload);
  }
}
