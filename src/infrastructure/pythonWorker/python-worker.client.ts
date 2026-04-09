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

export class PythonWorkerClient {
  private readonly client;

  constructor(baseUrl: string) {
    this.client = createHttpClient(baseUrl);
  }

  public async requestTranscription(payload: PythonTranscriptionRequest): Promise<unknown> {
    const response = await this.client.post("/transcribe", payload);
    return response.data;
  }

  public async requestClipAnalysis(payload: PythonAnalysisRequest): Promise<unknown> {
    const response = await this.client.post("/analyze", payload);
    return response.data;
  }
}
