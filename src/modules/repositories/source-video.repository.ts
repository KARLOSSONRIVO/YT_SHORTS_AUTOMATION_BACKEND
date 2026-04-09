import { SourceVideoModel, type SourceVideo, type SourceVideoDocument } from "../models/source-video.model";

export class SourceVideoRepository {
  public create(payload: Partial<SourceVideo>): Promise<SourceVideoDocument> {
    return SourceVideoModel.create(payload);
  }

  public findByProjectId(projectId: string): Promise<SourceVideoDocument | null> {
    return SourceVideoModel.findOne({ projectId }).sort({ createdAt: -1 }).exec();
  }

  public updateById(sourceVideoId: string, update: Partial<SourceVideo>): Promise<SourceVideoDocument | null> {
    return SourceVideoModel.findByIdAndUpdate(sourceVideoId, update, { new: true }).exec();
  }
}
