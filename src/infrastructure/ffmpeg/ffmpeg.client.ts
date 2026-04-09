import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

export interface RenderClipCommand {
  inputPath: string;
  outputPath: string;
  startTimeSeconds: number;
  durationSeconds: number;
  subtitlePath?: string;
}

export class FfmpegClient {
  constructor(private readonly ffmpegPath: string) {}

  public async renderClip(command: RenderClipCommand): Promise<void> {
    const args = [
      "-y",
      "-ss",
      `${command.startTimeSeconds}`,
      "-i",
      command.inputPath,
      "-t",
      `${command.durationSeconds}`
    ];

    if (command.subtitlePath) {
      args.push("-vf", `subtitles=${command.subtitlePath}`);
    }

    args.push("-c:v", "libx264", "-c:a", "aac", command.outputPath);

    await execFileAsync(this.ffmpegPath, args);
  }
}
