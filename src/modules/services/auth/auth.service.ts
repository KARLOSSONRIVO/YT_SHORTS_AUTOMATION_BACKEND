import { UserRepository } from "../../repositories/user.repository";

export interface MockLoginInput {
  email: string;
  displayName: string;
}

export class AuthService {
  constructor(private readonly userRepository: UserRepository) {}

  public loginOrRegister(input: MockLoginInput) {
    return this.userRepository.upsertByEmail({
      email: input.email,
      displayName: input.displayName
    });
  }
}
