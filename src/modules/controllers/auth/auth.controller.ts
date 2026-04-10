import type { Request, Response } from "express";
import { sendSuccess } from "../../../common/utils/api-response";
import { AuthService } from "../../services/auth/auth.service";

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  public register = async (request: Request, response: Response): Promise<void> => {
    const user = await this.authService.register(request.body);
    sendSuccess(response, user, 201);
  };

  public login = async (request: Request, response: Response): Promise<void> => {
    const user = await this.authService.login(request.body);
    sendSuccess(response, user, 200);
  };

  public mockLogin = async (request: Request, response: Response): Promise<void> => {
    const user = await this.authService.loginOrRegister(request.body);
    sendSuccess(response, user, 200);
  };
}
