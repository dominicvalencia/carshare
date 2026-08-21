import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { RoleCode } from '@carrental/database';
import type { ApiEnvironment } from '@carrental/config';
import { CryptoService } from '../security/crypto.service';

export interface AccessTokenClaims {
  readonly sub: string;
  readonly sessionId: string;
  readonly roles: readonly RoleCode[];
  readonly iat?: number;
  readonly exp?: number;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    @Inject(ConfigService) private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  signAccessToken(userId: string, sessionId: string, roles: readonly RoleCode[]): Promise<string> {
    return this.jwt.signAsync(
      { roles, sessionId, sub: userId },
      {
        audience: this.configuration.getOrThrow('JWT_AUDIENCE', { infer: true }),
        expiresIn: this.configuration.getOrThrow('ACCESS_TOKEN_TTL_SECONDS', { infer: true }),
        issuer: this.configuration.getOrThrow('JWT_ISSUER', { infer: true }),
        secret: this.configuration.getOrThrow('JWT_ACCESS_SECRET', { infer: true }),
      },
    );
  }

  verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    return this.jwt.verifyAsync<AccessTokenClaims>(token, {
      audience: this.configuration.getOrThrow('JWT_AUDIENCE', { infer: true }),
      issuer: this.configuration.getOrThrow('JWT_ISSUER', { infer: true }),
      secret: this.configuration.getOrThrow('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  opaqueToken(id: string): { raw: string; hash: string } {
    const raw = `${id}.${this.crypto.randomSecret()}`;
    return { hash: this.crypto.hashToken(raw), raw };
  }

  parseOpaqueId(raw: string): string | undefined {
    const [id, secret, extra] = raw.split('.');
    return id && secret && !extra ? id : undefined;
  }

  hashOpaque(raw: string): string {
    return this.crypto.hashToken(raw);
  }
}
