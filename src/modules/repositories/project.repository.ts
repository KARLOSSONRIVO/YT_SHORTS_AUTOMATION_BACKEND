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
    return ProjectModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  public updateById(projectId: string, update: UpdateQuery<Project>): Promise<ProjectDocument | null> {
    return ProjectModel.findByIdAndUpdate(projectId, update, { new: true }).exec();
  }

  public deleteById(projectId: string): Promise<ProjectDocument | null> {
    return ProjectModel.findByIdAndDelete(projectId).exec();
  }
}
