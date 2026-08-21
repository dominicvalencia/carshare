import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PayoutEncryptionService {
  private readonly key: Buffer;
  private readonly fingerprintSecret: string;

  constructor(@Inject(ConfigService) configuration: ConfigService) {
    this.key = Buffer.from(
      configuration.getOrThrow<string>('PAYOUT_DATA_ENCRYPTION_KEY_BASE64'),
      'base64',
    );
    this.fingerprintSecret = configuration.getOrThrow<string>('PAYOUT_IDENTIFIER_HASH_SECRET');
  }

  protect(value: string): {
    authTag: string;
    ciphertext: string;
    fingerprint: string;
    iv: string;
    masked: string;
  } {
    const normalized = value.trim();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
    return {
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      fingerprint: createHmac('sha256', this.fingerprintSecret)
        .update(`payout-destination:${normalized}`)
        .digest('hex'),
      iv: iv.toString('base64'),
      masked: this.mask(normalized),
    };
  }

  reveal(input: { authTag: string; ciphertext: string; iv: string }): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(input.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(input.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(input.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private mask(value: string): string {
    const visible = value.slice(-4);
    return `${'•'.repeat(Math.max(4, Math.min(8, value.length - 4)))}${visible}`;
  }
}
