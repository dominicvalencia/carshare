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
import { renterOnboardingStorage } from './renter-onboarding-storage';

interface AuthContextValue {
  readonly booting: boolean;
  readonly user: AuthUser | null;
  readonly renterOnboardingPending: boolean;
  login(identifier: string, password: string): Promise<void>;
  register(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refreshIdentity(): Promise<void>;
  skipRenterOnboarding(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [renterOnboardingPending, setRenterOnboardingPending] = useState(false);
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
      setRenterOnboardingPending(await renterOnboardingStorage.isPending(result.user.id));
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

  const value = useMemo<AuthContextValue>(
    () => ({
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
        try {
          await renterOnboardingStorage.markPending(result.user.id);
        } catch {
          // The guided onboarding marker is additive; server registration remains authoritative.
        }
        // A device-storage failure must not leave a successfully created account looking like
        // registration failed.
        await accept(result);
        setRenterOnboardingPending(true);
      },
      logout: async () => {
        const currentUserId = user?.id;
        sessionGeneration.current += 1;
        try {
          await apiClient.request('/auth/logout', { method: 'POST' });
        } finally {
          apiClient.setAccessToken(null);
          await tokenStorage.clear();
          if (currentUserId) await appLockStorage.clearAccount(currentUserId);
          setUser(null);
          setRenterOnboardingPending(false);
        }
      },
      refreshIdentity: async () => {
        const expectedGeneration = sessionGeneration.current;
        const refreshToken = await tokenStorage.getRefreshToken();
        if (refreshToken) await accept(await apiClient.refresh(refreshToken), expectedGeneration);
      },
      skipRenterOnboarding: async () => {
        if (!user) return;
        await renterOnboardingStorage.clear(user.id);
        setRenterOnboardingPending(false);
      },
    }),
    [accept, booting, renterOnboardingPending, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
