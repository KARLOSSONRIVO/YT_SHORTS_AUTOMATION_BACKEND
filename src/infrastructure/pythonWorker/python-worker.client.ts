import fs from "node:fs/promises";
import path from "node:path";
import { createHttpClient } from "../http/http.client";

export interface PythonTranscriptionRequest {
  jobId: string;
  projectId: string;
  sourceVideoPath: string;
  languageHint?: string;
}

export interface PythonAnalysisRequest {
  jobId: string;
  projectId: string;
  transcriptText: string;
  segments: Array<{
    startTimeSeconds: number;
    endTimeSeconds: number;
    text: string;
  }>;
}

export interface PythonMediaMetadata {
  media_uri: string;
  duration_seconds: number;
  format_name?: string;
  size_bytes?: number;
  has_audio: boolean;
  has_video: boolean;
  streams: Array<{
    index: number;
    codec_type: string;
    codec_name?: string;
    sample_rate?: number;
    channels?: number;
    width?: number;
    height?: number;
  }>;
}

export interface PythonTranscriptResponse {
  job_id: string;
  media: PythonMediaMetadata;
  transcript: {
    language: string;
    duration: number;
    full_text: string;
    segments: Array<{
      start: number;
      end: number;
      text: string;
      avg_logprob?: number;
      words?: Array<{
        start: number;
        end: number;
        word: string;
        probability?: number;
      }>;
    }>;
  };
}

export interface PythonAnalysisResponse {
  job_id: string;
  media: PythonMediaMetadata;
  transcript: {
    language: string;
    duration: number;
    full_text: string;
    segments: Array<{
      start: number;
      end: number;
      text: string;
      avg_logprob?: number;
      words?: Array<{
        start: number;
        end: number;
        word: string;
        probability?: number;
      }>;
    }>;
  };
  clips: Array<{
    start: number;
    end: number;
    title_hint?: string | null;
    transcript_excerpt: string;
    scores: {
      total_score: number;
    };
  }>;
  subtitles: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  warnings: string[];
}

export interface PythonRenderedClipResponse {
  clip_index: number;
  start: number;
  end: number;
  title_hint?: string | null;
  score: number;
  video_path: string;
  video_url: string;
  subtitles_path: string;
}

interface UploadRequestInput {
  filePath: string;
  fileName: string;
  mimeType: string;
  fields: Record<string, string>;
}

export class PythonWorkerClient {
  private readonly client;

  constructor(baseUrl: string, timeoutMs = 600_000) {
    this.client = createHttpClient(baseUrl, timeoutMs);
  }

  public async requestTranscription(payload: PythonTranscriptionRequest): Promise<unknown> {
    const response = await this.client.post("/internal/transcribe", payload);
    return response.data;
  }

  public async requestClipAnalysis(payload: PythonAnalysisRequest): Promise<unknown> {
    const response = await this.client.post("/internal/analyze-clips", payload);
    return response.data;
  }

  private async buildUploadFormData(input: UploadRequestInput): Promise<FormData> {
    const formData = new FormData();

    for (const [key, value] of Object.entries(input.fields)) {
      formData.append(key, value);
    }

    const fileBuffer = await fs.readFile(input.filePath);
    const blob = new Blob([fileBuffer], { type: input.mimeType || "application/octet-stream" });
    formData.append("file", blob, path.basename(input.fileName));

    return formData;
  }

  public async requestTranscriptionUpload(input: {
    jobId: string;
    filePath: string;
    fileName: string;
    mimeType: string;
    language?: string;
  }): Promise<PythonTranscriptResponse> {
    const formData = await this.buildUploadFormData({
      filePath: input.filePath,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fields: {
        job_id: input.jobId,
        ...(input.language ? { language: input.language } : {})
      }
    });

    const response = await this.client.post<PythonTranscriptResponse>("/internal/transcribe-upload", formData, {
      headers: formData instanceof FormData ? undefined : {}
    });

    return response.data;
  }

  public async requestClipAnalysisUpload(input: {
    jobId: string;
    filePath: string;
    fileName: string;
    mimeType: string;
    language?: string;
    minClipDuration?: number;
    maxClipDuration?: number;
    topK?: number;
    targetKeywords?: string[];
  }): Promise<PythonAnalysisResponse> {
    const formData = await this.buildUploadFormData({
      filePath: input.filePath,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fields: {
        job_id: input.jobId,
        ...(input.language ? { language: input.language } : {}),
        min_clip_duration: `${input.minClipDuration ?? 15}`,
        max_clip_duration: `${input.maxClipDuration ?? 45}`,
        top_k: `${input.topK ?? 5}`,
        target_keywords: (input.targetKeywords ?? []).join(",")
      }
    });

    const response = await this.client.post<PythonAnalysisResponse>("/internal/analyze-clips-upload", formData, {
      headers: formData instanceof FormData ? undefined : {}
    });

    return response.data;
  }

  public async requestRenderedClipUpload(input: {
    jobId: string;
    filePath: string;
    fileName: string;
    mimeType: string;
    clipStart: number;
    clipEnd: number;
    titleHint?: string;
    score?: number;
    transcriptJson: string;
    fontFamily?: string;
    fontSize?: number;
    fillColor?: string;
    strokeColor?: string;
    highlightColor?: string;
    position?: "bottom_center" | "top_center";
    maxCharsPerLine?: number;
    maxLines?: number;
  }): Promise<PythonRenderedClipResponse> {
    const formData = await this.buildUploadFormData({
      filePath: input.filePath,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fields: {
        job_id: input.jobId,
        clip_start: `${input.clipStart}`,
        clip_end: `${input.clipEnd}`,
        transcript_json: input.transcriptJson,
        ...(input.titleHint ? { title_hint: input.titleHint } : {}),
        score: `${input.score ?? 0}`,
        font_family: input.fontFamily ?? "Montserrat ExtraBold",
        font_size: `${input.fontSize ?? 64}`,
        fill_color: input.fillColor ?? "#FFFFFF",
        stroke_color: input.strokeColor ?? "#000000",
        highlight_color: input.highlightColor ?? "#FFD54A",
        position: input.position ?? "bottom_center",
        max_chars_per_line: `${input.maxCharsPerLine ?? 28}`,
        max_lines: `${input.maxLines ?? 2}`
      }
    });

    const response = await this.client.post<PythonRenderedClipResponse>("/internal/render-clip-upload", formData, {
      headers: formData instanceof FormData ? undefined : {}
    });

    return response.data;
  }

  public async downloadBinary(relativeOrAbsoluteUrl: string): Promise<Buffer> {
    const response = await this.client.get<ArrayBuffer>(relativeOrAbsoluteUrl, {
      responseType: "arraybuffer"
    });

    return Buffer.from(response.data);
  }
}
