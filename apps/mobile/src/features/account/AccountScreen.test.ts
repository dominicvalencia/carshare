import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'AccountScreen.tsx'),
  'utf8',
);

describe('contact verification presentation', () => {
  it('exposes email and Philippine mobile verification flows', () => {
    expect(source).toContain('Contact information');
    expect(source).toContain('/auth/email-verification/requests');
    expect(source).toContain('/auth/email-verification/confirmations');
    expect(source).toContain('/auth/mobile-verification/requests');
    expect(source).toContain('/auth/otp/verifications');
    expect(source).toContain('placeholder="09XXXXXXXXX"');
  });

  it('keeps the local delivery viewer out of production UI', () => {
    expect(source).toContain('__DEV__ &&');
    expect(source).toContain('/development/auth-deliveries');
  });
});
