import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiClient } from './api-client';
import type { AuthUser } from './auth.types';
import { tokenStorage } from './token-storage';
import { appLockStorage } from '../app-lock/storage';
import { activeRoleStorage } from '../navigation/active-role-storage';
import { ownerFirstEntryIntentStorage } from '../onboarding/owner-onboarding-storage';
import { ownerWorkspaceStorage } from '../navigation/owner-workspace-storage';

export type MarketplacePersona = 'RENTER' | 'OWNER';

interface AuthContextValue {
  readonly booting: boolean;
  readonly user: AuthUser | null;
  readonly renterOnboardingPending: boolean;
  login(identifier: string, password: string): Promise<void>;
  register(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refreshIdentity(): Promise<void>;
  enrollPersona(persona: MarketplacePersona): Promise<{ readonly newlyEnrolled: boolean }>;
  recordOwnerOnboardingEntry(): Promise<void>;
  skipRenterOnboarding(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const sessionGeneration = useRef(0);

  const accept = useCallback(
    async (
      result: Awaited<ReturnType<typeof apiClient.login>>,
      expectedGeneration = sessionGeneration.current,
    ): Promise<boolean> => {
      if (expectedGeneration !== sessionGeneration.current) return false;
      await tokenStorage.setRefreshToken(result.refreshToken);
      if (expectedGeneration !== sessionGeneration.current) return false;
      apiClient.setAccessToken(result.accessToken);
      setUser(result.user);
      return true;
    },
    [],
  );

  const expireSession = useCallback(async (): Promise<void> => {
    sessionGeneration.current += 1;
    apiClient.setAccessToken(null);
    await tokenStorage.clear();
    setUser(null);
  }, []);

  useEffect(() => {
    apiClient.configureAuthentication({
      refreshAccessToken: async () => {
        const expectedGeneration = sessionGeneration.current;
        const refreshToken = await tokenStorage.getRefreshToken();
        if (!refreshToken) return null;
        const result = await apiClient.refresh(refreshToken);
        return (await accept(result, expectedGeneration)) ? result.accessToken : null;
      },
      onAuthenticationExpired: expireSession,
    });
    const expectedGeneration = sessionGeneration.current;
    void tokenStorage
      .getRefreshToken()
      .then(async (refreshToken) => {
        if (!refreshToken) return;
        try {
          await accept(await apiClient.refresh(refreshToken), expectedGeneration);
        } catch {
          await expireSession();
        }
      })
      .finally(() => setBooting(false));
    return () => apiClient.configureAuthentication(null);
  }, [accept, expireSession]);

  const value = useMemo<AuthContextValue>(() => {
    const renterOnboardingPending = Boolean(
      user?.roles.includes('RENTER') && !user.profile?.renterOnboardingCompletedAt,
    );
    return {
      booting,
      renterOnboardingPending,
      user,
      login: async (identifier, password) => {
        sessionGeneration.current += 1;
        await accept(await apiClient.login(identifier, password));
      },
      register: async (email, password) => {
        sessionGeneration.current += 1;
        const result = await apiClient.register(email, password);
        await accept(result);
      },
      logout: async () => {
        const currentUserId = user?.id;
        sessionGeneration.current += 1;
        let serverLogoutError: unknown;
        try {
          await apiClient.request('/auth/logout', { method: 'POST' });
        } catch (error) {
          serverLogoutError = error;
        }
        apiClient.setAccessToken(null);
        setUser(null);
        const cleanup = await Promise.allSettled([
          tokenStorage.clear(),
          ...(currentUserId
            ? [
                appLockStorage.clearAccount(currentUserId),
                activeRoleStorage.clear(currentUserId),
                ownerWorkspaceStorage.clear(currentUserId),
              ]
            : []),
        ]);
        if (cleanup.some((result) => result.status === 'rejected')) {
          throw new Error('LOCAL_SESSION_CLEAR_FAILED');
        }
        if (serverLogoutError) throw serverLogoutError;
      },
      refreshIdentity: async () => {
        const expectedGeneration = sessionGeneration.current;
        const refreshToken = await tokenStorage.getRefreshToken();
        if (refreshToken) await accept(await apiClient.refresh(refreshToken), expectedGeneration);
      },
      enrollPersona: async (persona) => {
        const enrollment = await apiClient.request<{ newlyEnrolled: boolean }>('/me/personas', {
          body: JSON.stringify({ persona }),
          method: 'POST',
        });
        if (persona === 'OWNER' && enrollment.newlyEnrolled && user) {
          await Promise.all([
            activeRoleStorage.set(user.id, 'owner'),
            ownerFirstEntryIntentStorage.set(user.id),
          ]);
        }
        const expectedGeneration = sessionGeneration.current;
        const refreshToken = await tokenStorage.getRefreshToken();
        if (refreshToken) await accept(await apiClient.refresh(refreshToken), expectedGeneration);
        return enrollment;
      },
      recordOwnerOnboardingEntry: async () => {
        await apiClient.request('/me/personas/owner/onboarding-entry', { method: 'POST' });
        if (user) await ownerFirstEntryIntentStorage.clear(user.id);
      },
      skipRenterOnboarding: async () => {
        if (!user) return;
        await apiClient.request('/me/personas/renter/onboarding-completion', { method: 'POST' });
        const expectedGeneration = sessionGeneration.current;
        const refreshToken = await tokenStorage.getRefreshToken();
        if (refreshToken) await accept(await apiClient.refresh(refreshToken), expectedGeneration);
      },
    };
  }, [accept, booting, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
