import { QUEUE_NAMES } from "../../../infrastructure/queue/queue.names";
import { NotFoundError } from "../../../common/errors/not-found-error";
import { JobRepository } from "../../repositories/job.repository";

export class JobService {
  constructor(private readonly jobRepository: JobRepository) {}

  public createQueuedJob(input: {
    projectId: string;
    clipId?: string;
    queueName: (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
    type: string;
    payload: Record<string, unknown>;
  }) {
    return this.jobRepository.create({
      projectId: input.projectId as never,
      clipId: input.clipId as never,
      queueName: input.queueName,
      type: input.type,
      payload: input.payload,
      status: "queued"
    });
  }

  public async getJobOrThrow(jobId: string) {
    const job = await this.jobRepository.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job not found.", { jobId });
    }

    return job;
  }

  public listByProjectId(projectId: string) {
    return this.jobRepository.findByProjectId(projectId);
  }

  public updateJob(jobId: string, payload: Record<string, unknown>) {
    return this.jobRepository.updateById(jobId, payload as never);
  }
}
