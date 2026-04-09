import { NotFoundError } from "../../../common/errors/not-found-error";
import { ClipRepository } from "../../repositories/clip.repository";
import { StorageService } from "../storage/storage.service";
import { ClipService } from "../clip/clip.service";

export class SubtitleService {
  constructor(
    private readonly clipRepository: ClipRepository,
    private readonly clipService: ClipService,
    private readonly storageService: StorageService
  ) {}

  public async saveClipSubtitle(projectId: string, clipId: string, content: string) {
    const storedSubtitle = await this.storageService.saveSubtitle(projectId, clipId, content);
    await this.clipService.attachSubtitle(clipId, storedSubtitle.storageKey);
    return storedSubtitle;
  }

  public async getClipSubtitle(clipId: string) {
    const clip = await this.clipRepository.findById(clipId);
    if (!clip) {
      throw new NotFoundError("Clip not found.", { clipId });
    }

    if (!clip.subtitleStorageKey) {
      throw new NotFoundError("Subtitle not found for clip.", { clipId });
    }

    return {
      clipId,
      storageKey: clip.subtitleStorageKey,
      absolutePath: this.storageService.resolveStoragePath(clip.subtitleStorageKey)
    };
  }
}
