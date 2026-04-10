import fs from "node:fs/promises";
import { NotFoundError } from "../../../common/errors/not-found-error";
import { ClipRepository } from "../../repositories/clip.repository";
import { StorageService } from "../storage/storage.service";
import { ClipService } from "../clip/clip.service";

const parseSrtTimestamp = (value: string): number => {
  const [timePart, millisecondsPart = "0"] = value.split(",");
  const [hours = "0", minutes = "0", seconds = "0"] = timePart.split(":");
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(millisecondsPart) / 1000
  );
};

const parseSrtSegments = (content: string) => {
  return content
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/).filter(Boolean);
      const timeLine = lines[1] ?? "";
      const [startRaw = "", endRaw = ""] = timeLine.split(" --> ");
      return {
        start: parseSrtTimestamp(startRaw),
        end: parseSrtTimestamp(endRaw),
        text: lines.slice(2).join(" ")
      };
    })
    .filter((segment) => segment.text.length > 0);
};

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

    const absolutePath = this.storageService.resolveStoragePath(clip.subtitleStorageKey);
    const content = await fs.readFile(absolutePath, "utf8");

    return {
      clipId,
      storageKey: clip.subtitleStorageKey,
      absolutePath,
      content,
      segments: parseSrtSegments(content)
    };
  }
}
