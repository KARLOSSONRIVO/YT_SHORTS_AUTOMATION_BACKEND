import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "../errors/app-error";
import { UserRepository } from "../../modules/repositories/user.repository";
import { AuthTokenService } from "../../modules/services/auth/auth-token.service";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  status: "active" | "disabled";
}

const AUTH_USER_KEY = Symbol("shortsStudio.authUser");

type AuthenticatedRequest = Request & {
  [AUTH_USER_KEY]?: AuthenticatedUser;
};

const toAuthenticatedUser = (request: Request): AuthenticatedUser | undefined =>
  (request as AuthenticatedRequest)[AUTH_USER_KEY];

export const getAuthenticatedUser = (request: Request): AuthenticatedUser => {
  const authUser = toAuthenticatedUser(request);

  if (!authUser) {
    throw new AppError("Authentication required.", 401, "UNAUTHORIZED");
  }

  return authUser;
};

export const createRequireAuth = (
  authTokenService: AuthTokenService,
  userRepository: UserRepository
): RequestHandler => {
  return (request: Request, _response: Response, next: NextFunction) => {
    void (async () => {
      const authorizationHeader = request.get("authorization");

      if (!authorizationHeader?.startsWith("Bearer ")) {
        throw new AppError("Authentication required.", 401, "UNAUTHORIZED");
      }

      const token = authorizationHeader.slice("Bearer ".length).trim();
      const payload = authTokenService.verifyToken(token);

      if (!payload) {
        throw new AppError("Your session is invalid or has expired.", 401, "INVALID_AUTH_TOKEN");
      }

      const user = await userRepository.findById(payload.sub);

      if (!user || user.status !== "active") {
        throw new AppError("This account is not active.", 403, "ACCOUNT_DISABLED");
      }

      (request as AuthenticatedRequest)[AUTH_USER_KEY] = {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
        status: user.status
      };
    })()
      .then(() => next())
      .catch(next);
  };
};
