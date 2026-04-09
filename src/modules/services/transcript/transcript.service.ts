import { NotFoundError } from "../../../common/errors/not-found-error";
import { PythonWorkerClient } from "../../../infrastructure/pythonWorker/python-worker.client";
import { TranscriptRepository } from "../../repositories/transcript.repository";

export interface TranscriptSegmentInput {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
}

export interface StoreTranscriptInput {
  projectId: string;
  sourceVideoId: string;
  language: string;
  rawText: string;
  segments: TranscriptSegmentInput[];
  provider?: string;
}

export class TranscriptService {
  constructor(
    private readonly transcriptRepository: TranscriptRepository,
    private readonly pythonWorkerClient: PythonWorkerClient
  ) {}

  public storeTranscript(input: StoreTranscriptInput) {
    return this.transcriptRepository.create({
      projectId: input.projectId as never,
      sourceVideoId: input.sourceVideoId as never,
      language: input.language,
      rawText: input.rawText,
      segments: input.segments,
      provider: input.provider ?? "python-worker",
      status: "completed"
    });
  }

  public async getByProjectIdOrThrow(projectId: string) {
    const transcript = await this.transcriptRepository.findByProjectId(projectId);
    if (!transcript) {
      throw new NotFoundError("Transcript not found for project.", { projectId });
    }

    return transcript;
  }

  public requestTranscription(jobId: string, projectId: string, sourceVideoPath: string, languageHint?: string) {
    return this.pythonWorkerClient.requestTranscription({
      jobId,
      projectId,
      sourceVideoPath,
      languageHint
    });
  }
}
