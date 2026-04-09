import { TranscriptModel, type Transcript, type TranscriptDocument } from "../models/transcript.model";

export class TranscriptRepository {
  public create(payload: Partial<Transcript>): Promise<TranscriptDocument> {
    return TranscriptModel.create(payload);
  }

  public findByProjectId(projectId: string): Promise<TranscriptDocument | null> {
    return TranscriptModel.findOne({ projectId }).sort({ createdAt: -1 }).exec();
  }

  public updateById(transcriptId: string, update: Partial<Transcript>): Promise<TranscriptDocument | null> {
    return TranscriptModel.findByIdAndUpdate(transcriptId, update, { new: true }).exec();
  }
}
