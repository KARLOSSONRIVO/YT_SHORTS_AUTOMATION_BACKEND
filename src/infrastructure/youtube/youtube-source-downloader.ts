import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError } from "../../common/errors/app-error";
import { logger } from "../../config/logger";

export interface DownloadedYouTubeSource {
  filePath: string;
  directory: string;
  originalFileName: string;
  mimeType: "video/mp4";
  sizeBytes: number;
}

export type YtDlpRunner = (
  executablePath: string,
  args: string[],
  options: { timeout: number; maxBuffer: number }
) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: YtDlpRunner = (executablePath, args, options) =>
  new Promise((resolve, reject) => {
    execFile(executablePath, args, { ...options, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stderr: String(stderr ?? "") });
        reject(error);
        return;
      }

      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });

const errorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return "YouTube source download failed.";
  }

  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
  return stderr.split(/\r?\n/).reverse().find((line) => line.startsWith("ERROR:")) || stderr || error.message;
};

export class YouTubeSourceDownloader {
  constructor(
    private readonly executablePath = "yt-dlp",
    private readonly runner: YtDlpRunner = defaultRunner,
    private readonly timeoutMs = 15 * 60 * 1000
  ) {}

  public async download(sourceUrl: string): Promise<DownloadedYouTubeSource> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-source-"));
    const baseName = `youtube-source-${crypto.randomUUID()}`;
    const outputTemplate = path.join(directory, `${baseName}.%(ext)s`);
    const args = [
      "--no-playlist",
      "--js-runtimes",
      "node",
      "--format",
      "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
      "--no-progress",
      "--quiet",
      "--merge-output-format",
      "mp4",
      "--output",
      outputTemplate,
      sourceUrl
    ];

    try {
      await this.runner(this.executablePath, args, { timeout: this.timeoutMs, maxBuffer: 4 * 1024 * 1024 });
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const mediaEntry = entries.find(
        (entry) => entry.isFile() && [".mp4", ".mkv", ".webm", ".mov"].includes(path.extname(entry.name).toLowerCase())
      );

      if (!mediaEntry) {
        throw new Error("yt-dlp completed without producing a video file.");
      }

      const filePath = path.join(directory, mediaEntry.name);
      const stat = await fs.stat(filePath);
      return {
        filePath,
        directory,
        originalFileName: mediaEntry.name,
        mimeType: "video/mp4",
        sizeBytes: stat.size
      };
    } catch (error) {
      await this.cleanup({ directory } as DownloadedYouTubeSource);
      if (error instanceof AppError) throw error;
      logger.warn("YouTube source download failed.", { reason: errorMessage(error) });
      if (error instanceof Error && "killed" in error && error.killed) {
        throw new AppError("The YouTube download timed out. Try a shorter video.", 504, "YOUTUBE_SOURCE_TIMEOUT");
      }
      throw new AppError(
        "The server could not download this video from YouTube. Check that it is publicly playable, or upload the video file.",
        502,
        "YOUTUBE_SOURCE_DOWNLOAD_FAILED"
      );
    }
  }

  public cleanup(downloaded: Pick<DownloadedYouTubeSource, "directory">): Promise<void> {
    return fs.rm(downloaded.directory, { recursive: true, force: true });
  }
}
