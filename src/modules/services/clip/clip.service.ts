import { AppError } from "../../../common/errors/app-error";
import { NotFoundError } from "../../../common/errors/not-found-error";
import { ClipRepository } from "../../repositories/clip.repository";

import type { Clip } from "../../models/clip.model";
import type { ClipRange } from "../../validators/clip.validator";

export interface CandidateClipInput {
  projectId: string;
  sourceVideoId: string;
  transcriptId?: string;
  title: string;
  hashtags?: string;
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

  public async reviewClip(
    clipId: string,
    reviewStatus: "approved" | "rejected",
    edits: Pick<Clip, "verticalLayout" | "captionPlacement" | "captionPreset" | "captionFontSize"> & { clipRange?: ClipRange } = {}
  ) {
    const { verticalLayout, captionPlacement, captionPreset, captionFontSize, clipRange } = edits;
    const publishStatus = reviewStatus === "approved" ? "queued" : "not_ready";
    if (reviewStatus === "approved" && (verticalLayout || clipRange || captionPlacement || captionPreset || captionFontSize !== undefined)) {
      const clip = await this.clipRepository.approveEditedClip(clipId, {
        ...(verticalLayout && { verticalLayout }),
        ...(captionPlacement && { captionPlacement }),
        ...(captionPreset && { captionPreset }),
        ...(captionFontSize !== undefined && { captionFontSize }),
        ...(clipRange && {
          ...clipRange,
          durationSeconds: clipRange.endTimeSeconds - clipRange.startTimeSeconds,
          rangeEdited: true
        })
      });
      if (!clip) throw new AppError("This clip is no longer available for editing.", 409, "CLIP_REVIEW_CONFLICT");
      return clip;
    }
    return this.clipRepository.updateById(clipId, { reviewStatus, publishStatus });
  }

  public markRendered(clipId: string, outputStorageKey: string) {
    return this.clipRepository.updateById(clipId, {
      renderStatus: "rendered",
      outputStorageKey
    });
  }

  public markRendering(clipId: string) {
    return this.clipRepository.updateById(clipId, {
      renderStatus: "rendering"
    });
  }

  public markRenderFailed(clipId: string) {
    return this.clipRepository.updateById(clipId, {
      renderStatus: "failed"
    });
  }

  public clearRenderedOutput(clipId: string) {
    return this.clipRepository.updateById(clipId, {
      outputStorageKey: undefined,
      subtitleStorageKey: undefined,
      renderStatus: "queued",
      publishStatus: "not_ready"
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

  public markPublishFailed(clipId: string) {
    return this.clipRepository.updateById(clipId, {
      publishStatus: "failed"
    });
  }
}
