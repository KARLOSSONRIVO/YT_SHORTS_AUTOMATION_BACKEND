import { UploadHistoryModel, type UploadHistory, type UploadHistoryDocument } from "../models/upload-history.model";

export class UploadHistoryRepository {
  public create(payload: Partial<UploadHistory>): Promise<UploadHistoryDocument> {
    return UploadHistoryModel.create(payload);
  }
}
