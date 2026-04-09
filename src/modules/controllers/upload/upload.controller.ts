import type { Request, Response } from "express";
import { AppError } from "../../../common/errors/app-error";
import { sendSuccess } from "../../../common/utils/api-response";
import { UploadService } from "../../services/upload/upload.service";

export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  public createUpload = async (request: Request, response: Response): Promise<void> => {
    if (!request.file) {
      throw new AppError("A video file is required.", 400, "FILE_REQUIRED");
    }

    const result = await this.uploadService.createUploadWorkflow({
      ...request.body,
      file: request.file
    });

    sendSuccess(response, result, 201);
  };
}
