import crypto from "node:crypto";
import { AppError } from "../../../common/errors/app-error";
import { UserRepository } from "../../repositories/user.repository";

export interface MockLoginInput {
  email: string;
  displayName: string;
}

export interface RegisterInput {
  email: string;
  displayName: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

const HASH_KEY_LENGTH = 64;

const hashPassword = (password: string): string => {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, HASH_KEY_LENGTH).toString("hex");
  return `${salt}:${derivedKey}`;
};

const verifyPassword = (password: string, passwordHash: string): boolean => {
  const [salt, storedKey] = passwordHash.split(":");

  if (!salt || !storedKey) {
    return false;
  }

  const derivedKey = crypto.scryptSync(password, salt, HASH_KEY_LENGTH);
  const storedBuffer = Buffer.from(storedKey, "hex");

  if (derivedKey.length !== storedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedKey, storedBuffer);
};

export class AuthService {
  constructor(private readonly userRepository: UserRepository) {}

  private toAuthUser(user: {
    id?: string;
    _id?: { toString(): string };
    email: string;
    displayName: string;
    roles?: string[];
    status: "active" | "disabled";
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    return {
      id: user.id ?? user._id?.toString(),
      email: user.email,
      displayName: user.displayName,
      roles: user.roles ?? ["user"],
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  public loginOrRegister(input: MockLoginInput) {
    return this.userRepository.upsertByEmail({
      email: input.email,
      displayName: input.displayName
    }).then((user) => this.toAuthUser(user));
  }

  public async register(input: RegisterInput) {
    const existingUser = await this.userRepository.findByEmail(input.email);

    if (existingUser) {
      throw new AppError("An account with that email already exists.", 409, "EMAIL_ALREADY_IN_USE");
    }

    const user = await this.userRepository.create({
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      passwordHash: hashPassword(input.password),
      roles: ["user"],
      status: "active"
    });

    return this.toAuthUser(user);
  }

  public async login(input: LoginInput) {
    const user = await this.userRepository.findByEmail(input.email);

    if (!user || !user.passwordHash || !verifyPassword(input.password, user.passwordHash)) {
      throw new AppError("Invalid email or password.", 401, "INVALID_CREDENTIALS");
    }

    if (user.status !== "active") {
      throw new AppError("This account is not active.", 403, "ACCOUNT_DISABLED");
    }

    return this.toAuthUser(user);
  }
}
