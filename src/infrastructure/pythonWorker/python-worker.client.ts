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

export interface PythonFacelessScene {
  scene_index: number;
  narration: string;
  image_prompt: string;
  duration_seconds: number;
  caption_text: string;
}

export interface PythonFacelessScriptResponse {
  job_id: string;
  project_id: string;
  title: string;
  hook: string;
  narration: string;
  scenes: PythonFacelessScene[];
  image_prompts: string[];
  caption_text: string;
}

export interface PythonFacelessAudioResponse {
  job_id: string;
  project_id: string;
  audio_path: string;
  audio_url: string;
  duration_seconds: number;
  voice: string;
}

export interface PythonFacelessVoice {
  voice: string;
  label: string;
  language: string;
  gender: string;
  quality_grade?: string | null;
  sample_text: string;
}

export interface PythonFacelessVoicePreviewResponse {
  voice: string;
  audio_path: string;
  audio_url: string;
  sample_text: string;
}

export interface PythonFacelessSubtitleResponse {
  job_id: string;
  project_id: string;
  srt_path: string;
  ass_path: string;
  timestamp_json_path: string;
  srt_url: string;
  ass_url: string;
  timestamp_json_url: string;
  subtitles: Array<{
    index: number;
    start: number;
    end: number;
    text: string;
  }>;
}

export interface PythonFacelessSceneImageResponse {
  job_id: string;
  project_id: string;
  images: Array<{
    scene_index: number;
    prompt: string;
    image_path: string;
    image_url: string;
  }>;
}

export interface PythonFacelessSceneAnimationResponse {
  job_id: string;
  project_id: string;
  animations: Array<{
    scene_index: number;
    prompt: string;
    source_image_path: string;
    video_path: string;
    video_url: string;
    cache_key: string;
  }>;
}

export interface PythonFacelessAmbienceResponse {
  job_id: string;
  project_id: string;
  ambience: Array<{
    scene_index: number;
    prompt: string;
    audio_path: string;
    audio_url?: string | null;
    duration_seconds: number;
    cache_key: string;
    cached: boolean;
    mood: string;
    environment: string;
    emotional_tone: string;
    tension_level: number;
  }>;
}

export interface PythonFacelessRenderResponse {
  job_id: string;
  project_id: string;
  video_path: string;
  video_url: string;
  duration_seconds: number;
}

export interface PythonProjectOutputCleanupResponse {
  project_id: string;
  deleted: boolean;
}

interface UploadRequestInput {
  filePath: string;
  fileName: string;
  mimeType: string;
  fields: Record<string, string>;
}

export class PythonWorkerClient {
  private readonly client;

  constructor(baseUrl: string, timeoutMs = 0) {
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
    projectId: string;
    projectTitle?: string;
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
    position?: "bottom_center" | "top_center" | "middle_center";
    maxCharsPerLine?: number;
    maxLines?: number;
  }): Promise<PythonRenderedClipResponse> {
    const formData = await this.buildUploadFormData({
      filePath: input.filePath,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fields: {
        job_id: input.jobId,
        project_id: input.projectId,
        ...(input.projectTitle ? { project_title: input.projectTitle } : {}),
        clip_start: `${input.clipStart}`,
        clip_end: `${input.clipEnd}`,
        transcript_json: input.transcriptJson,
        ...(input.titleHint ? { title_hint: input.titleHint } : {}),
        score: `${input.score ?? 0}`,
        font_family: input.fontFamily ?? "Bebas Neue",
        font_size: `${input.fontSize ?? 92}`,
        fill_color: input.fillColor ?? "#FFFFFF",
        stroke_color: input.strokeColor ?? "#000000",
        highlight_color: input.highlightColor ?? "#FFFFFF",
        position: input.position ?? "middle_center",
        max_chars_per_line: `${input.maxCharsPerLine ?? 18}`,
        max_lines: `${input.maxLines ?? 2}`
      }
    });

    const response = await this.client.post<PythonRenderedClipResponse>("/internal/render-clip-upload", formData, {
      headers: formData instanceof FormData ? undefined : {}
    });

    return response.data;
  }

  public async requestFacelessScript(input: {
    jobId: string;
    projectId: string;
    projectTitle?: string;
    topic: string;
    tone?: string;
    language?: string;
    targetDurationSeconds?: number;
    stylePreset?: string;
    audience?: string;
    scriptFramework?: "psychology_truth" | "history_story";
  }): Promise<PythonFacelessScriptResponse> {
    const response = await this.client.post<PythonFacelessScriptResponse>("/internal/faceless/generate-script", {
      job_id: input.jobId,
      project_id: input.projectId,
      project_title: input.projectTitle,
      topic: input.topic,
      tone: input.tone,
      language: input.language,
      target_duration_seconds: input.targetDurationSeconds,
      style_preset: input.stylePreset,
      audience: input.audience,
      script_framework: input.scriptFramework
    });

    return response.data;
  }

  public async requestFacelessAudio(input: {
    jobId: string;
    projectId: string;
    projectTitle?: string;
    outputBucket?: string;
    narration: string;
    voice?: string;
    speakingRate?: number;
  }): Promise<PythonFacelessAudioResponse> {
    const response = await this.client.post<PythonFacelessAudioResponse>("/internal/faceless/generate-audio", {
      job_id: input.jobId,
      project_id: input.projectId,
      project_title: input.projectTitle,
      output_bucket: input.outputBucket,
      narration: input.narration,
      voice: input.voice,
      speaking_rate: input.speakingRate ?? 0.82
    });

    return response.data;
  }

  public async requestFacelessVoices(): Promise<PythonFacelessVoice[]> {
    const response = await this.client.get<PythonFacelessVoice[]>("/internal/faceless/voices");
    return response.data;
  }

  public async requestFacelessVoicePreview(input: {
    voice: string;
    text?: string;
  }): Promise<PythonFacelessVoicePreviewResponse> {
    const response = await this.client.post<PythonFacelessVoicePreviewResponse>("/internal/faceless/preview-voice", {
      voice: input.voice,
      text: input.text
    });

    return response.data;
  }

  public async requestFacelessSubtitles(input: {
    jobId: string;
    projectId: string;
    projectTitle?: string;
    openingDisplayText?: string;
    outputBucket?: string;
    audioPath?: string;
    scenes: PythonFacelessScene[];
    subtitlePreferences?: {
      fontFamily?: string;
      fontSize?: number;
      fillColor?: string;
      strokeColor?: string;
      highlightColor?: string;
      position?: "bottom_center" | "top_center" | "middle_center";
      maxCharsPerLine?: number;
      maxLines?: number;
    };
  }): Promise<PythonFacelessSubtitleResponse> {
    const response = await this.client.post<PythonFacelessSubtitleResponse>("/internal/faceless/generate-subtitles", {
      job_id: input.jobId,
      project_id: input.projectId,
      project_title: input.projectTitle,
      opening_display_text: input.openingDisplayText,
      output_bucket: input.outputBucket,
      audio_path: input.audioPath,
      scenes: input.scenes,
      font_family: input.subtitlePreferences?.fontFamily,
      font_size: input.subtitlePreferences?.fontSize,
      fill_color: input.subtitlePreferences?.fillColor,
      stroke_color: input.subtitlePreferences?.strokeColor,
      highlight_color: input.subtitlePreferences?.highlightColor,
      position: input.subtitlePreferences?.position,
      max_chars_per_line: input.subtitlePreferences?.maxCharsPerLine,
      max_lines: input.subtitlePreferences?.maxLines
    });

    return response.data;
  }

  public async requestFacelessScenes(input: {
    jobId: string;
    projectId: string;
    projectTitle?: string;
    outputBucket?: string;
    scenes: PythonFacelessScene[];
    visualStyle?: string;
  }): Promise<PythonFacelessSceneImageResponse> {
    const response = await this.client.post<PythonFacelessSceneImageResponse>("/internal/faceless/generate-scenes", {
      job_id: input.jobId,
      project_id: input.projectId,
      project_title: input.projectTitle,
      output_bucket: input.outputBucket,
      scenes: input.scenes,
      visual_style: input.visualStyle
    });

    return response.data;
  }

  public async requestFacelessAnimations(input: {
    jobId: string;
    projectId: string;
    projectTitle?: string;
    outputBucket?: string;
    scenes: PythonFacelessScene[];
    images: Array<{
      scene_index: number;
      prompt: string;
      image_path: string;
      image_url: string;
    }>;
    animationStyle?: string;
  }): Promise<PythonFacelessSceneAnimationResponse> {
    const response = await this.client.post<PythonFacelessSceneAnimationResponse>("/internal/faceless/generate-animations", {
      job_id: input.jobId,
      project_id: input.projectId,
      project_title: input.projectTitle,
      output_bucket: input.outputBucket,
      scenes: input.scenes,
      images: input.images,
      animation_style: input.animationStyle
    });

    return response.data;
  }

  public async requestFacelessAmbience(input: {
    jobId: string;
    projectId: string;
    projectTitle?: string;
    outputBucket?: string;
    scenes: PythonFacelessScene[];
    outputFormat?: "wav" | "mp3";
  }): Promise<PythonFacelessAmbienceResponse> {
    const response = await this.client.post<PythonFacelessAmbienceResponse>("/internal/faceless/generate-ambience", {
      job_id: input.jobId,
      project_id: input.projectId,
      project_title: input.projectTitle,
      output_bucket: input.outputBucket,
      scenes: input.scenes,
      output_format: input.outputFormat ?? "wav"
    });

    return response.data;
  }

  public async requestFacelessRender(input: {
    jobId: string;
    projectId: string;
    projectTitle?: string;
    outputBucket?: string;
    scenes: PythonFacelessScene[];
    imagePaths: string[];
    sceneVideoPaths?: string[];
    audioPath: string;
    subtitlesPath?: string;
    backgroundMusicPath?: string;
    backgroundVideoPath?: string;
    ambienceAudioPaths?: string[];
    renderMode?: "scene_images" | "background_video" | "animation_story";
    musicVolume?: number;
    narrationVolume?: number;
  }): Promise<PythonFacelessRenderResponse> {
    const response = await this.client.post<PythonFacelessRenderResponse>("/internal/faceless/render", {
      job_id: input.jobId,
      project_id: input.projectId,
      project_title: input.projectTitle,
      output_bucket: input.outputBucket,
      scenes: input.scenes,
      image_paths: input.imagePaths,
      scene_video_paths: input.sceneVideoPaths ?? [],
      audio_path: input.audioPath,
      subtitles_path: input.subtitlesPath,
      background_music_path: input.backgroundMusicPath,
      background_video_path: input.backgroundVideoPath,
      ambience_audio_paths: input.ambienceAudioPaths ?? [],
      render_mode: input.renderMode ?? "scene_images",
      music_volume: input.musicVolume,
      narration_volume: input.narrationVolume
    });

    return response.data;
  }

  public async requestProjectOutputCleanup(input: {
    projectId: string;
    projectTitle?: string;
    outputBucket?: string;
  }): Promise<PythonProjectOutputCleanupResponse> {
    const response = await this.client.post<PythonProjectOutputCleanupResponse>(
      "/internal/faceless/cleanup-project-output",
      {
        project_id: input.projectId,
        project_title: input.projectTitle,
        output_bucket: input.outputBucket
      }
    );

    return response.data;
  }

  public async downloadBinary(relativeOrAbsoluteUrl: string): Promise<Buffer> {
    const response = await this.client.get<ArrayBuffer>(relativeOrAbsoluteUrl, {
      responseType: "arraybuffer"
    });

    return Buffer.from(response.data);
  }
}
