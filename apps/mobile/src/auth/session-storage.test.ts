import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStore = vi.hoisted(() => ({
  deleteItemAsync: vi.fn(async () => undefined),
  getItemAsync: vi.fn(async (_key: string): Promise<string | null> => null),
  setItemAsync: vi.fn(async () => undefined),
}));

vi.mock('expo-secure-store', () => ({
  ...secureStore,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

import { tokenStorage } from './token-storage';
import { activeRoleStorage } from '../navigation/active-role-storage';
import { ownerWorkspaceStorage } from '../navigation/owner-workspace-storage';
import {
  ownerFirstEntryIntentStorage,
  ownerOnboardingStorage,
} from '../onboarding/owner-onboarding-storage';

describe('local authenticated-session storage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes the persisted refresh token during logout cleanup', async () => {
    await tokenStorage.clear();

    expect(secureStore.deleteItemAsync).toHaveBeenCalledExactlyOnceWith('carrental.refresh-token');
  });

  it('deletes only the current principal saved marketplace mode', async () => {
    await activeRoleStorage.clear('user-123');

    expect(secureStore.deleteItemAsync).toHaveBeenCalledExactlyOnceWith('active-role_user-123');
  });

  it('returns null for missing or malformed saved marketplace modes', async () => {
    await expect(activeRoleStorage.get('user-123')).resolves.toBeNull();
    secureStore.getItemAsync.mockResolvedValueOnce('administrator');
    await expect(activeRoleStorage.get('user-123')).resolves.toBeNull();
  });

  it('restores only a valid saved marketplace mode', async () => {
    secureStore.getItemAsync.mockResolvedValueOnce('owner');
    await expect(activeRoleStorage.get('user-123')).resolves.toBe('owner');
    secureStore.getItemAsync.mockResolvedValueOnce('renter');
    await expect(activeRoleStorage.get('user-123')).resolves.toBe('renter');
  });

  it('persists and clears Owner workspace selection per authenticated user', async () => {
    await ownerWorkspaceStorage.set('user-123', 'owner-profile-456');
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'active-owner-workspace_user-123',
      'owner-profile-456',
    );
    secureStore.getItemAsync.mockResolvedValueOnce('owner-profile-456');
    await expect(ownerWorkspaceStorage.get('user-123')).resolves.toBe('owner-profile-456');
    await ownerWorkspaceStorage.clear('user-123');
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('active-owner-workspace_user-123');
  });

  it('continues to store refresh tokens with device-only unlock accessibility', async () => {
    await tokenStorage.setRefreshToken('controlled-test-token');

    expect(secureStore.setItemAsync).toHaveBeenCalledExactlyOnceWith(
      'carrental.refresh-token',
      'controlled-test-token',
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
    );
  });

  it('stores Owner guided-onboarding dismissal as a non-authorizing device preference', async () => {
    await ownerOnboardingStorage.dismiss('owner-123');

    expect(secureStore.setItemAsync).toHaveBeenCalledExactlyOnceWith(
      'owner-onboarding-dismissed_owner-123',
      'true',
    );
  });

  it('restores the Owner guide dismissal preference on relaunch', async () => {
    secureStore.getItemAsync.mockResolvedValueOnce('true');

    await expect(ownerOnboardingStorage.isDismissed('owner-123')).resolves.toBe(true);
    expect(secureStore.getItemAsync).toHaveBeenCalledExactlyOnceWith(
      'owner-onboarding-dismissed_owner-123',
    );
  });

  it('persists and clears the principal-scoped first Owner entry intent', async () => {
    await ownerFirstEntryIntentStorage.set('owner-123');
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'owner-first-entry-intent_owner-123',
      'true',
    );
    secureStore.getItemAsync.mockResolvedValueOnce('true');
    await expect(ownerFirstEntryIntentStorage.exists('owner-123')).resolves.toBe(true);
    await ownerFirstEntryIntentStorage.clear('owner-123');
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('owner-first-entry-intent_owner-123');
  });
});
