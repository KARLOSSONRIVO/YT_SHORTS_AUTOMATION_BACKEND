import { ClipModel, type Clip, type ClipDocument } from "../models/clip.model";

export class ClipRepository {
  public createMany(payload: Partial<Clip>[]): Promise<ClipDocument[]> {
    return ClipModel.insertMany(payload) as Promise<ClipDocument[]>;
  }

  public findById(clipId: string): Promise<ClipDocument | null> {
    return ClipModel.findById(clipId).exec();
  }

  public findByProjectId(projectId: string): Promise<ClipDocument[]> {
    return ClipModel.find({ projectId }).sort({ createdAt: -1 }).exec();
  }

  public updateById(clipId: string, update: Partial<Clip>): Promise<ClipDocument | null> {
    return ClipModel.findByIdAndUpdate(clipId, update, { new: true }).exec();
  }

  public deleteByProjectId(projectId: string) {
    return ClipModel.deleteMany({ projectId }).exec();
  }
}
