import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiClient } from './api-client';
import type { AuthUser } from './auth.types';
import { tokenStorage } from './token-storage';

interface AuthContextValue {
  readonly booting: boolean;
  readonly user: AuthUser | null;
  login(identifier: string, password: string): Promise<void>;
  register(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    void tokenStorage
      .getRefreshToken()
      .then(async (refreshToken) => {
        if (!refreshToken) return;
        try {
          await accept(await apiClient.refresh(refreshToken));
        } catch {
          await tokenStorage.clear();
        }
      })
      .finally(() => setBooting(false));
  }, []);

  async function accept(result: Awaited<ReturnType<typeof apiClient.login>>): Promise<void> {
    apiClient.setAccessToken(result.accessToken);
    await tokenStorage.setRefreshToken(result.refreshToken);
    setUser(result.user);
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      booting,
      user,
      login: async (identifier, password) => accept(await apiClient.login(identifier, password)),
      register: async (email, password) => accept(await apiClient.register(email, password)),
      logout: async () => {
        try {
          await apiClient.request('/auth/logout', { method: 'POST' });
        } finally {
          apiClient.setAccessToken(null);
          await tokenStorage.clear();
          setUser(null);
        }
      },
    }),
    [booting, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
