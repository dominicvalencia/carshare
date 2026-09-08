import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/notifications/PushRegistration.tsx'),
  'utf8',
);

describe('push registration safety', () => {
  it('creates the Android channel before requesting an Expo token', () => {
    expect(source.indexOf("setNotificationChannelAsync('default'")).toBeGreaterThan(-1);
    expect(source.indexOf("setNotificationChannelAsync('default'")).toBeLessThan(
      source.indexOf('getExpoPushTokenAsync'),
    );
  });

  it('avoids a final-denial nag loop and refreshes token registration', () => {
    expect(source).toContain('existing.canAskAgain');
    expect(source).toContain('addPushTokenListener');
    expect(source).toContain('tokenSubscription.remove()');
  });

  it('keeps strict scheme and destination allowlisting', () => {
    expect(source).toContain('ALLOWED_PUSH_TARGETS');
    expect(source).toContain("'notifications'");
    expect(source).toContain('parsed.protocol === `${expectedScheme}:`');
  });
});
