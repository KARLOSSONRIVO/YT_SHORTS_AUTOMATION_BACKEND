import { JobModel, type Job, type JobDocument } from "../models/job.model";

export class JobRepository {
  public create(payload: Partial<Job>): Promise<JobDocument> {
    return JobModel.create(payload);
  }

  public findById(jobId: string): Promise<JobDocument | null> {
    return JobModel.findById(jobId).exec();
  }

  public findByProjectId(projectId: string): Promise<JobDocument[]> {
    return JobModel.find({ projectId }).sort({ createdAt: -1 }).exec();
  }

  public updateById(jobId: string, update: Partial<Job>): Promise<JobDocument | null> {
    return JobModel.findByIdAndUpdate(jobId, update, { new: true }).exec();
  }

  public deleteByProjectId(projectId: string) {
    return JobModel.deleteMany({ projectId }).exec();
  }
}
