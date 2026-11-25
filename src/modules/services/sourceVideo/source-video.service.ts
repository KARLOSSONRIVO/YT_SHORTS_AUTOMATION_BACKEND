import { NotFoundError } from "../../../common/errors/not-found-error";
import type { MediaInspectionService } from "../../automation/media-inspection.service";
import { SourceVideoRepository } from "../../repositories/source-video.repository";
import type { StorageService } from "../storage/storage.service";

export interface CreateSourceVideoInput {
  projectId: string;
  originalFileName: string;
  mimeType: string;
  storageKey: string;
  sizeBytes: number;
  sourceUrl?: string;
}

export class SourceVideoService {
  constructor(
    private readonly sourceVideoRepository: SourceVideoRepository,
    private readonly storageService: StorageService,
    private readonly mediaInspectionService: MediaInspectionService
  ) {}

  public readDurationSeconds(storageKey: string) {
    return this.mediaInspectionService.readDurationSeconds(this.storageService.resolveStoragePath(storageKey));
  }

  public createSourceVideo(input: CreateSourceVideoInput) {
    return this.sourceVideoRepository.create({
      projectId: input.projectId as never,
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      storageKey: input.storageKey,
      sizeBytes: input.sizeBytes,
      sourceUrl: input.sourceUrl,
      status: "uploaded"
    });
  }

  public async getByProjectIdOrThrow(projectId: string) {
    const sourceVideo = await this.sourceVideoRepository.findByProjectId(projectId);
    if (!sourceVideo) {
      throw new NotFoundError("Source video not found for project.", { projectId });
    }

    return sourceVideo;
  }

  public updateSourceVideo(sourceVideoId: string, payload: Record<string, unknown>) {
    return this.sourceVideoRepository.updateById(sourceVideoId, payload as never);
  }
}
