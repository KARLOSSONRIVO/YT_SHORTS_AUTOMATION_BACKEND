import { UploadHistoryModel, type UploadHistory, type UploadHistoryDocument } from "../models/upload-history.model";

export class UploadHistoryRepository {
  public create(payload: Partial<UploadHistory>): Promise<UploadHistoryDocument> {
    return UploadHistoryModel.create(payload);
  }

  public findMissingArchiveRecords(): Promise<UploadHistoryDocument[]> {
    return UploadHistoryModel.find({
      status: "uploaded",
      $or: [{ localArchiveStorageKey: { $exists: false } }, { localArchiveStorageKey: null }, { localArchiveStorageKey: "" }]
    })
      .sort({ uploadedAt: -1, createdAt: -1 })
      .exec();
  }

  public findLatestByClipId(clipId: string): Promise<UploadHistoryDocument | null> {
    return UploadHistoryModel.findOne({ clipId }).sort({ uploadedAt: -1, createdAt: -1 }).exec();
  }

  public findLatestByProjectId(projectId: string): Promise<UploadHistoryDocument | null> {
    return UploadHistoryModel.findOne({ projectId }).sort({ uploadedAt: -1, createdAt: -1 }).exec();
  }

  public updateById(uploadHistoryId: string, update: Partial<UploadHistory>): Promise<UploadHistoryDocument | null> {
    return UploadHistoryModel.findByIdAndUpdate(uploadHistoryId, update, { new: true }).exec();
  }
}
