import { QUEUE_NAMES } from "../../../infrastructure/queue/queue.names";
import { StorageService } from "../storage/storage.service";
import { ProjectService } from "../project/project.service";
import { SourceVideoService } from "../sourceVideo/source-video.service";
import { QueueService } from "../queue/queue.service";
import { JobService } from "../job/job.service";

export interface CreateUploadWorkflowInput {
  userId: string;
  title: string;
  description?: string;
  file: Express.Multer.File;
}

export class UploadService {
  constructor(
    private readonly storageService: StorageService,
    private readonly projectService: ProjectService,
    private readonly sourceVideoService: SourceVideoService,
    private readonly queueService: QueueService,
    private readonly jobService: JobService
  ) {}

  public async createUploadWorkflow(input: CreateUploadWorkflowInput) {
    const storedSourceVideo = await this.storageService.storeSourceVideo(input.file);
    const project = await this.projectService.createProject({
      userId: input.userId,
      title: input.title,
      description: input.description
    });

    const sourceVideo = await this.sourceVideoService.createSourceVideo({
      projectId: project.id,
      originalFileName: input.file.originalname,
      mimeType: input.file.mimetype,
      storageKey: storedSourceVideo.storageKey,
      sizeBytes: input.file.size
    });

    const persistedJob = await this.jobService.createQueuedJob({
      projectId: project.id,
      queueName: QUEUE_NAMES.INGEST,
      type: "project.ingest",
      payload: {
        projectId: project.id,
        sourceVideoId: sourceVideo.id,
        storageKey: storedSourceVideo.storageKey
      }
    });

    const enqueuedJob = await this.queueService.addIngestJob({
      jobId: persistedJob.id,
      projectId: project.id,
      sourceVideoId: sourceVideo.id,
      storageKey: storedSourceVideo.storageKey
    });

    await this.jobService.updateJob(persistedJob.id, { externalJobId: `${enqueuedJob.id}` });

    return {
      project,
      sourceVideo,
      job: {
        id: persistedJob.id,
        queueName: persistedJob.queueName,
        externalJobId: `${enqueuedJob.id}`,
        status: persistedJob.status
      }
    };
  }
}
