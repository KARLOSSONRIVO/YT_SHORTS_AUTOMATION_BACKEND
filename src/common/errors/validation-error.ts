import { AppError } from "./app-error";

export class RequestValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, "VALIDATION_ERROR", details);
    this.name = "RequestValidationError";
  }
}
