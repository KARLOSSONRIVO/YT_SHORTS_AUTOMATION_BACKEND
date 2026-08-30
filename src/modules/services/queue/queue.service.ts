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

  public addStoryJob(payload: Record<string, unknown>, options?: JobsOptions) {
    return this.add("STORY", "faceless.story.requested", payload, {
      attempts: 1000,
      backoff: { type: "provider-rate-limit" },
      ...options
    });
  }

  public addRenderJob(payload: Record<string, unknown>) {
    return this.add("RENDER", "clip.render.requested", payload);
  }

  public addUploadJob(payload: Record<string, unknown>) {
    return this.add("UPLOAD", "clip.upload.requested", payload);
  }

  public async addAutomationJob(payload: Record<string, unknown>, options?: JobsOptions) {
    const jobId = options?.jobId == null ? undefined : String(options.jobId);
    if (jobId) {
      const existing = await this.queues[QUEUE_NAMES.AUTOMATION].getJob(jobId);
      if (existing && await existing.isFailed()) await existing.remove();
      else if (existing) return existing;
    }
    return this.add("AUTOMATION", "project.daily-story.requested", payload, options);
  }

  public async removeExternalJob(
    queueName: (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES],
    externalJobId?: string
  ): Promise<void> {
    if (!externalJobId) {
      return;
    }

    const queueJob = await this.queues[queueName].getJob(externalJobId);
    if (!queueJob) {
      return;
    }

    await queueJob.remove().catch(() => undefined);
  }
}
