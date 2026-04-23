import crypto from "node:crypto";

export interface AuthTokenPayload {
  sub: string;
  email: string;
  displayName: string;
  roles: string[];
  status: "active" | "disabled";
  exp: number;
}

const encodeBase64Url = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const decodeBase64Url = (value: string) => Buffer.from(value, "base64url").toString("utf8");

export class AuthTokenService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number
  ) {}

  public issueToken(payload: Omit<AuthTokenPayload, "exp">): string {
    const tokenPayload: AuthTokenPayload = {
      ...payload,
      exp: Math.floor(Date.now() / 1000) + this.ttlSeconds
    };
    const encodedPayload = encodeBase64Url(JSON.stringify(tokenPayload));
    const signature = this.sign(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  public verifyToken(token: string): AuthTokenPayload | null {
    const [encodedPayload, signature] = token.split(".");

    if (!encodedPayload || !signature) {
      return null;
    }

    const expectedSignature = this.sign(encodedPayload);
    const signatureBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");

    if (signatureBuffer.length !== expectedBuffer.length) {
      return null;
    }

    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return null;
    }

    try {
      const payload = JSON.parse(decodeBase64Url(encodedPayload)) as AuthTokenPayload;
      if (!payload.sub || !payload.email || !payload.displayName || !Array.isArray(payload.roles) || !payload.exp) {
        return null;
      }

      if (payload.exp <= Math.floor(Date.now() / 1000)) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  private sign(value: string): string {
    return crypto.createHmac("sha256", this.secret).update(value).digest("base64url");
  }
}
