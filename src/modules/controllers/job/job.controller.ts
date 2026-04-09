import type { Request, Response } from "express";
import { sendSuccess } from "../../../common/utils/api-response";
import { JobService } from "../../services/job/job.service";

export class JobController {
  constructor(private readonly jobService: JobService) {}

  public listJobs = async (request: Request, response: Response): Promise<void> => {
    const jobs = await this.jobService.listByProjectId(request.query.projectId as string);
    sendSuccess(response, jobs);
  };
}
