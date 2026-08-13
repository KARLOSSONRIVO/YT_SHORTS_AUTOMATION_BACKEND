import path from "node:path";
import { ProjectRepository } from "../../repositories/project.repository";
import { ClipRepository } from "../../repositories/clip.repository";
import { JobRepository } from "../../repositories/job.repository";
import { SourceVideoRepository } from "../../repositories/source-video.repository";
import { TranscriptRepository } from "../../repositories/transcript.repository";
import { FacelessVideoRepository } from "../../repositories/faceless-video.repository";
import { UploadHistoryRepository } from "../../repositories/upload-history.repository";
import { ProjectService } from "./project.service";
import { StorageService } from "../storage/storage.service";
import { PythonWorkerClient } from "../../../infrastructure/pythonWorker/python-worker.client";
import { QueueService } from "../queue/queue.service";

export class ProjectCleanupService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly projectRepository: ProjectRepository,
    private readonly clipRepository: ClipRepository,
    private readonly jobRepository: JobRepository,
    private readonly sourceVideoRepository: SourceVideoRepository,
    private readonly transcriptRepository: TranscriptRepository,
    private readonly facelessVideoRepository: FacelessVideoRepository,
    private readonly uploadHistoryRepository: UploadHistoryRepository,
    private readonly storageService: StorageService,
    private readonly pythonWorkerClient: PythonWorkerClient,
    private readonly queueService: QueueService
  ) {}

  public async deleteProject(projectId: string) {
    const project = await this.projectService.getProjectOrThrow(projectId);
    const [clips, jobs, sourceVideos, uploadHistory] = await Promise.all([
      this.clipRepository.findByProjectId(projectId),
      this.jobRepository.findByProjectId(projectId),
      this.sourceVideoRepository.findManyByProjectId(projectId),
      this.uploadHistoryRepository.findByProjectId(projectId)
    ]);

    const cleanupTasks: Array<Promise<unknown>> = [];

    for (const job of jobs) {
      cleanupTasks.push(this.queueService.removeExternalJob(job.queueName, job.externalJobId));
    }

    for (const sourceVideo of sourceVideos) {
      cleanupTasks.push(this.storageService.delete(sourceVideo.storageKey));
    }

    for (const clip of clips) {
      if (clip.outputStorageKey) {
        cleanupTasks.push(this.storageService.delete(clip.outputStorageKey));
      }
      if (clip.subtitleStorageKey) {
        cleanupTasks.push(this.storageService.delete(clip.subtitleStorageKey));
      }
    }

    for (const history of uploadHistory) {
      if (history.localArchiveStorageKey) {
        cleanupTasks.push(this.storageService.delete(history.localArchiveStorageKey));
      }
      if (history.localArchiveMetadataKey) {
        cleanupTasks.push(this.storageService.delete(history.localArchiveMetadataKey));
      }
    }

    cleanupTasks.push(this.storageService.deleteDirectory(path.posix.join("renders", projectId)));
    cleanupTasks.push(this.storageService.deleteDirectory(path.posix.join("subtitles", projectId)));
    cleanupTasks.push(
      this.storageService.deleteDirectory(path.posix.join("published", this.sanitizePathSegment(project.title)))
    );
    cleanupTasks.push(
      this.pythonWorkerClient.requestProjectOutputCleanup({
        projectId,
        projectTitle: project.title,
        outputBucket: this.outputBucketForProject(project)
      })
    );

    await Promise.allSettled(cleanupTasks);

    await Promise.all([
      this.clipRepository.deleteByProjectId(projectId),
      this.jobRepository.deleteByProjectId(projectId),
      this.sourceVideoRepository.deleteByProjectId(projectId),
      this.transcriptRepository.deleteByProjectId(projectId),
      this.uploadHistoryRepository.deleteByProjectId(projectId),
      this.facelessVideoRepository.deleteProjectData(projectId),
      this.projectRepository.deleteById(projectId)
    ]);

    return {
      projectId,
      deleted: true
    };
  }

  private sanitizePathSegment(value: string): string {
    const normalized = value.trim().replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_");
    const collapsed = normalized.replace(/\s+/g, " ").trim();
    return collapsed || "untitled";
  }

  private outputBucketForProject(project: { projectType: string; facelessSource?: string; contentType?: string }) {
    if (project.projectType === "uploaded_video") {
      return "clipping";
    }
    if (project.contentType === "REDDIT_STORY") {
      return "reddit";
    }
    return "faceless_story";
  }
}
