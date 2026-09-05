import { describe, expect, it } from 'vitest';
import { cameraPermissionAction } from './camera-permission-policy';

describe('cameraPermissionAction', () => {
  it('uses the camera immediately when permission is granted', () => {
    expect(cameraPermissionAction({ granted: true, canAskAgain: true })).toBe('allow');
  });

  it('requests permission only while iOS permits another prompt', () => {
    expect(cameraPermissionAction({ granted: false, canAskAgain: true })).toBe('request');
  });

  it('routes permanently denied permission to Settings', () => {
    expect(cameraPermissionAction({ granted: false, canAskAgain: false })).toBe('settings');
  });

  it('presents shared user-facing recovery with an app Settings action', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), 'camera-permission.ts'),
      'utf8',
    );
    expect(source).toContain('Camera access is required');
    expect(source).toContain('Linking.openSettings()');
    expect(source).toContain('getCameraPermissionsAsync()');
  });
});
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
