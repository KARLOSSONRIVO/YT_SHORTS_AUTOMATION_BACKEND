import { NotFoundError } from "../../../common/errors/not-found-error";
import { ClipRepository } from "../../repositories/clip.repository";

export interface CandidateClipInput {
  projectId: string;
  sourceVideoId: string;
  transcriptId?: string;
  title: string;
  description?: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  score: number;
  analysisReason?: string;
}

export class ClipService {
  constructor(private readonly clipRepository: ClipRepository) {}

  public async createCandidateClips(input: CandidateClipInput[]) {
    return this.clipRepository.createMany(
      input.map((clip) => ({
        ...clip,
        projectId: clip.projectId as never,
        sourceVideoId: clip.sourceVideoId as never,
        transcriptId: clip.transcriptId as never,
        durationSeconds: clip.endTimeSeconds - clip.startTimeSeconds,
        reviewStatus: "pending_review",
        renderStatus: "queued",
        publishStatus: "not_ready"
      }))
    );
  }

  public listByProjectId(projectId: string) {
    return this.clipRepository.findByProjectId(projectId);
  }

  public async getClipOrThrow(clipId: string) {
    const clip = await this.clipRepository.findById(clipId);
    if (!clip) {
      throw new NotFoundError("Clip not found.", { clipId });
    }

    return clip;
  }

  public async reviewClip(clipId: string, reviewStatus: "approved" | "rejected") {
    const publishStatus = reviewStatus === "approved" ? "queued" : "not_ready";
    return this.clipRepository.updateById(clipId, {
      reviewStatus,
      publishStatus
    });
  }

  public markRendered(clipId: string, outputStorageKey: string) {
    return this.clipRepository.updateById(clipId, {
      renderStatus: "rendered",
      outputStorageKey
    });
  }

  public attachSubtitle(clipId: string, subtitleStorageKey: string) {
    return this.clipRepository.updateById(clipId, {
      subtitleStorageKey
    });
  }

  public markPublishQueued(clipId: string) {
    return this.clipRepository.updateById(clipId, {
      publishStatus: "queued"
    });
  }

  public markPublished(clipId: string) {
    return this.clipRepository.updateById(clipId, {
      publishStatus: "published",
      publishedAt: new Date()
    });
  }
}
