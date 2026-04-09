import { Types } from "mongoose";
import { RequestValidationError } from "../errors/validation-error";

export const ensureObjectId = (value: string, fieldName = "id"): string => {
  if (!Types.ObjectId.isValid(value)) {
    throw new RequestValidationError(`Invalid ${fieldName} provided.`, { [fieldName]: value });
  }

  return value;
};
