import { AppError } from "./app-error";

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 404, "NOT_FOUND", details);
    this.name = "NotFoundError";
  }
}
