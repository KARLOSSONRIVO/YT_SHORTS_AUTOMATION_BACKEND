import { UserModel, type User, type UserDocument } from "../models/user.model";

export class UserRepository {
  public create(payload: Pick<User, "email" | "displayName" | "roles" | "status"> & Partial<User>): Promise<UserDocument> {
    return UserModel.create(payload);
  }

  public upsertByEmail(payload: Pick<User, "email" | "displayName"> & Partial<User>): Promise<UserDocument> {
    return UserModel.findOneAndUpdate(
      { email: payload.email },
      payload,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).exec() as Promise<UserDocument>;
  }

  public findByEmail(email: string): Promise<UserDocument | null> {
    return UserModel.findOne({ email: email.trim().toLowerCase() }).exec();
  }

  public findById(userId: string): Promise<UserDocument | null> {
    return UserModel.findById(userId).exec();
  }
}
