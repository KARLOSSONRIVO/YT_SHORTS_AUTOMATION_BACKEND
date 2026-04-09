import { HydratedDocument, Schema, model } from "mongoose";

export interface User {
  email: string;
  displayName: string;
  roles: string[];
  status: "active" | "disabled";
}

const userSchema = new Schema<User>(
  {
    email: { type: String, required: true, unique: true, index: true, trim: true, lowercase: true },
    displayName: { type: String, required: true, trim: true },
    roles: { type: [String], default: ["user"] },
    status: { type: String, enum: ["active", "disabled"], default: "active" }
  },
  { timestamps: true }
);

export type UserDocument = HydratedDocument<User>;
export const UserModel = model<User>("User", userSchema);
