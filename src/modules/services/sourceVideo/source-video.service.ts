import { NotFoundError } from "../../../common/errors/not-found-error";
import { SourceVideoRepository } from "../../repositories/source-video.repository";

export interface CreateSourceVideoInput {
  projectId: string;
  originalFileName: string;
  mimeType: string;
  storageKey: string;
  sizeBytes: number;
}

export class SourceVideoService {
  constructor(private readonly sourceVideoRepository: SourceVideoRepository) {}

  public createSourceVideo(input: CreateSourceVideoInput) {
    return this.sourceVideoRepository.create({
      projectId: input.projectId as never,
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      storageKey: input.storageKey,
      sizeBytes: input.sizeBytes,
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
