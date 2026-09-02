import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const lockScreen = readFileSync(resolve(directory, 'AppLockScreen.tsx'), 'utf8');
const settings = readFileSync(resolve(directory, 'AppLockSettings.tsx'), 'utf8');

describe('app-lock interaction regression', () => {
  it('automatically attempts OS biometrics once and exposes an explicit retry', () => {
    expect(lockScreen).toContain('automaticBiometricAttempted');
    expect(lockScreen).toContain('Try Again');
    expect(lockScreen).toContain('unlockWithBiometrics');
  });

  it('has no custom PIN unlock or setup path', () => {
    expect(lockScreen).not.toContain('PasscodeInput');
    expect(settings).not.toContain('PasscodeInput');
    expect(lockScreen).not.toMatch(/Forgot PIN|six-digit app PIN/);
    expect(settings).not.toMatch(/Change PIN|Save PIN|PBKDF/);
    expect(lockScreen).toContain('Log Out');
  });
});
