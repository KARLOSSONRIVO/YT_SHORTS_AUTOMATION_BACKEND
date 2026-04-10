import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

export interface RenderClipCommand {
  inputPath: string;
  outputPath: string;
  startTimeSeconds: number;
  durationSeconds: number;
  subtitlePath?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  videoZoomFactor?: number;
  videoYOffset?: number;
}

export class FfmpegClient {
  constructor(private readonly ffmpegPath: string) {}

  private escapeFilterPath(filePath: string): string {
    return path
      .resolve(filePath)
      .replace(/\\/g, "/")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'");
  }

  public async renderClip(command: RenderClipCommand): Promise<void> {
    const canvasWidth = command.canvasWidth ?? 1080;
    const canvasHeight = command.canvasHeight ?? 1920;
    const zoomFactor = command.videoZoomFactor ?? 1.1;
    const videoYOffset = command.videoYOffset ?? 0;
    const videoFilterParts = [
      `scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=decrease`,
      `scale=iw*${zoomFactor}:ih*${zoomFactor}`,
      `crop=min(iw\\,${canvasWidth}):ih:(iw-min(iw\\,${canvasWidth}))/2:0`,
      `pad=${canvasWidth}:${canvasHeight}:(ow-iw)/2:${videoYOffset}:color=black`
    ];

    if (command.subtitlePath) {
      videoFilterParts.push(`subtitles='${this.escapeFilterPath(command.subtitlePath)}'`);
    }

    const args = [
      "-y",
      "-ss",
      `${command.startTimeSeconds}`,
      "-t",
      `${command.durationSeconds}`,
      "-i",
      command.inputPath,
      "-vf",
      videoFilterParts.join(","),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      command.outputPath
    ];

    await execFileAsync(this.ffmpegPath, args);
  }
}
