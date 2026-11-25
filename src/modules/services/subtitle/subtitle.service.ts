import fs from "node:fs/promises";
import { NotFoundError } from "../../../common/errors/not-found-error";
import type { ClipDocument } from "../../models/clip.model";
import { StorageService } from "../storage/storage.service";
import { ClipService } from "../clip/clip.service";
import type { TranscriptService } from "../transcript/transcript.service";

type SubtitleSegment = { start: number; end: number; text: string };

const srtTimestamp = (seconds: number): string => {
  const totalMilliseconds = Math.max(Math.round(seconds * 1000), 0);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
};

export function clipSubtitleSegments(subtitles: SubtitleSegment[], clipStart: number, clipEnd: number) {
  return subtitles
    .filter((segment) => segment.end > clipStart && segment.start < clipEnd && segment.text.trim())
    .map((segment) => ({
      start: Math.max(segment.start - clipStart, 0),
      end: Math.min(segment.end, clipEnd) - clipStart,
      text: segment.text.trim()
    }));
}

export function buildSubtitleSrt(segments: SubtitleSegment[]) {
  return segments.map(({ start, end, text }, index) =>
    `${index + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(end)}\n${text}`
  ).join("\n\n");
}

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
    private readonly clipService: ClipService,
    private readonly storageService: StorageService,
    private readonly transcriptService: TranscriptService
  ) {}

  public async saveClipSubtitle(projectId: string, clipId: string, content: string) {
    const storedSubtitle = await this.storageService.saveSubtitle(projectId, clipId, content);
    await this.clipService.attachSubtitle(clipId, storedSubtitle.storageKey);
    return storedSubtitle;
  }

  public async getClipSubtitle(clip: ClipDocument) {
    const clipId: string = clip.id;
    const mayEdit = clip.reviewStatus === "pending_review";
    const transcript = mayEdit || clip.rangeEdited
      ? await this.transcriptService.findByProjectId(String(clip.projectId))
      : null;
    const sourceSegments = transcript?.segments.map((segment) => ({
      start: segment.startTimeSeconds,
      end: segment.endTimeSeconds,
      text: segment.text,
      words: segment.words.map((word) => ({ start: word.startTimeSeconds, end: word.endTimeSeconds, text: word.word }))
    }));

    if (clip.rangeEdited || (!clip.subtitleStorageKey && sourceSegments)) {
      const segments = clipSubtitleSegments(sourceSegments ?? [], clip.startTimeSeconds, clip.endTimeSeconds);
      return { clipId, segments, content: buildSubtitleSrt(segments), sourceSegments: mayEdit ? sourceSegments : undefined };
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
      segments: parseSrtSegments(content),
      sourceSegments
    };
  }
}
