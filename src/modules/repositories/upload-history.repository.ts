import { UploadHistoryModel, type UploadHistory, type UploadHistoryDocument } from "../models/upload-history.model";

export class UploadHistoryRepository {
  public create(payload: Partial<UploadHistory>): Promise<UploadHistoryDocument> {
    return UploadHistoryModel.create(payload);
  }

  public findLatestByProjectId(projectId: string): Promise<UploadHistoryDocument | null> {
    return UploadHistoryModel.findOne({ projectId }).sort({ uploadedAt: -1, createdAt: -1 }).exec();
  }
}
