import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

export class MediaInspectionService {
  constructor(private readonly ffprobePath: string, private readonly ffmpegPath: string) {}
  public async inspect(filePath: string) {
    const { stdout } = await execFileAsync(this.ffprobePath, ["-v","error","-show_streams","-show_format","-of","json",filePath]);
    const data = JSON.parse(stdout) as { streams?: Array<{codec_type?:string;width?:number;height?:number}>; format?: {duration?:string} };
    const video = data.streams?.find((stream) => stream.codec_type === "video");
    const audio = data.streams?.find((stream) => stream.codec_type === "audio");
    let blackOutput = "";
    try { const result = await execFileAsync(this.ffmpegPath, ["-hide_banner","-i",filePath,"-vf","blackdetect=d=0.5:pic_th=0.98","-an","-f","null","-"]); blackOutput = result.stderr; }
    catch (error) { blackOutput = typeof error === "object" && error && "stderr" in error ? String((error as {stderr?:unknown}).stderr) : ""; }
    return { durationSeconds: Number(data.format?.duration ?? 0), width: video?.width, height: video?.height, hasAudio: Boolean(audio), blankSceneCount: (blackOutput.match(/black_start:/g) ?? []).length };
  }
}
