import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
  return stderr || error.message || "YouTube source download failed.";
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
      "--no-progress",
      "--quiet",
      "--format",
      "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
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
      throw new Error(`Could not prepare the YouTube source: ${errorMessage(error)}`);
    }
  }

  public cleanup(downloaded: Pick<DownloadedYouTubeSource, "directory">): Promise<void> {
    return fs.rm(downloaded.directory, { recursive: true, force: true });
  }
}
