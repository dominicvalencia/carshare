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
    expect(lockScreen).toContain('Try Face ID again');
    expect(lockScreen).toContain('unlockWithBiometrics');
  });

  it('uses the six-digit passcode primitive rather than a normal secure field', () => {
    expect(lockScreen).toContain('PasscodeInput');
    expect(settings).toContain('PasscodeInput');
    expect(lockScreen).not.toContain('<Field');
  });

  it('auto-submits at digit six, keeps a Done key, and resets an incorrect PIN', () => {
    const primitive = readFileSync(resolve(directory, '../ui/primitives.tsx'), 'utf8');
    expect(primitive).toContain('value.length === 6');
    expect(primitive).toContain('returnKeyType="done"');
    expect(primitive).toContain('secureTextEntry');
    expect(lockScreen).toContain("setPin('')");
  });
});
