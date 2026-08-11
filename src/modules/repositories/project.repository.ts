import type { FilterQuery, UpdateQuery } from "mongoose";
import { ProjectModel, type Project, type ProjectDocument } from "../models/project.model";

export class ProjectRepository {
  public create(payload: Partial<Project>): Promise<ProjectDocument> {
    return ProjectModel.create(payload);
  }

  public findById(projectId: string): Promise<ProjectDocument | null> {
    return ProjectModel.findById(projectId).exec();
  }

  public findMany(filter: FilterQuery<Project> = {}): Promise<ProjectDocument[]> {
    return ProjectModel.find({ internalStory: { $ne: true }, ...filter }).sort({ createdAt: -1 }).exec();
  }

  public findOwnedById(projectId: string, userId: string): Promise<ProjectDocument | null> {
    return ProjectModel.findOne({ _id: projectId, userId, internalStory: { $ne: true } }).exec();
  }

  public findDue(now: Date, limit = 25): Promise<ProjectDocument[]> {
    return ProjectModel.find({ contentType: { $in: ["FACELESS_NICHE", "REDDIT_STORY", "CLIP_UPLOAD"] },
      internalStory: { $ne: true }, automationEnabled: true, nextRunAt: { $lte: now } })
      .sort({ nextRunAt: 1 }).limit(limit).exec();
  }

  public claimDue(projectId: string, expectedNextRunAt: Date, nextRunAt: Date): Promise<ProjectDocument | null> {
    return ProjectModel.findOneAndUpdate(
      { _id: projectId, automationEnabled: true, nextRunAt: expectedNextRunAt },
      { $set: { nextRunAt, lastRunAt: new Date(), automationStatus: "running" } },
      { new: true }
    ).exec();
  }

  public findInternalStories(parentProjectId: string): Promise<ProjectDocument[]> {
    return ProjectModel.find({ parentProjectId, internalStory: true }).sort({ createdAt: -1 }).exec();
  }

  public updateById(projectId: string, update: UpdateQuery<Project>): Promise<ProjectDocument | null> {
    return ProjectModel.findByIdAndUpdate(projectId, update, { new: true }).exec();
  }

  public deleteById(projectId: string): Promise<ProjectDocument | null> {
    return ProjectModel.findByIdAndDelete(projectId).exec();
  }
}
