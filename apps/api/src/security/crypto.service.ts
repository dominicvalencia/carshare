import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash, verify, argon2id } from 'argon2';
import type { ApiEnvironment } from '@carrental/config';

const commonPasswords = new Set([
  '123456789012',
  'password1234',
  'qwertyuiop12',
  'letmein123456',
  'philippines123',
]);

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly tokenHashSecret: string;
  private dummyPasswordHash = '';

  constructor(@Inject(ConfigService) configuration: ConfigService<ApiEnvironment, true>) {
    this.tokenHashSecret = configuration.getOrThrow('TOKEN_HASH_SECRET', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    this.dummyPasswordHash = await this.hashPassword('not-a-real-user-password');
  }

  assertPasswordPolicy(password: string): void {
    if (password.length < 12 || password.length > 128) {
      throw new Error('Password must contain between 12 and 128 characters.');
    }
    if (commonPasswords.has(password.toLowerCase()) || /^(.)\1+$/.test(password)) {
      throw new Error('Choose a less common password.');
    }
  }

  hashPassword(password: string): Promise<string> {
    return hash(password, { memoryCost: 19_456, parallelism: 1, timeCost: 2, type: argon2id });
  }

  verifyPassword(hashValue: string | null, password: string): Promise<boolean> {
    return verify(hashValue ?? this.dummyPasswordHash, password);
  }

  randomSecret(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  randomOtp(): string {
    const value = randomBytes(4).readUInt32BE() % 1_000_000;
    return value.toString().padStart(6, '0');
  }

  hashToken(value: string): string {
    return createHmac('sha256', this.tokenHashSecret).update(value).digest('hex');
  }

  hashIdentifier(value: string): string {
    return createHmac('sha256', this.tokenHashSecret).update(`identifier:${value}`).digest('hex');
  }

  checksum(value: Buffer): string {
    return createHash('sha256').update(value).digest('hex');
  }

  secureEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
