'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

interface Envelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { readonly message: string };
}

interface AdminSessionValue {
  readonly accessToken: string;
  readonly logout: () => void;
}

const AdminSessionContext = createContext<AdminSessionValue | null>(null);

export function AdminSessionProvider({ children }: { readonly children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const value = useMemo(
    () => ({
      accessToken: accessToken ?? '',
      logout: () => {
        setAccessToken(null);
        queryClient.clear();
      },
    }),
    [accessToken, queryClient],
  );
  if (!accessToken) return <AdminLogin onAuthenticated={setAccessToken} />;
  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession() {
  const session = useContext(AdminSessionContext);
  if (!session) throw new Error('Admin session is unavailable.');
  return session;
}

function AdminLogin({ onAuthenticated }: { readonly onAuthenticated: (token: string) => void }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${API_URL}/admin/auth/login`, {
        body: JSON.stringify({ identifier, password, platform: 'WEB' }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as Envelope<{ accessToken: string }>;
      if (!response.ok || !envelope.data)
        throw new Error(envelope.error?.message ?? 'Login failed.');
      return envelope.data.accessToken;
    },
    onSuccess: onAuthenticated,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate();
  };
  return (
    <main className="admin-login-page">
      <form className="login-card" onSubmit={submit}>
        <span className="eyebrow">PROTECTED ADMINISTRATION</span>
        <h1>Operations sign in</h1>
        <p>Use an authorized administrative account to continue.</p>
        <label>
          Email or mobile
          <input
            autoComplete="username"
            onChange={(event) => setIdentifier(event.target.value)}
            value={identifier}
          />
        </label>
        <label>
          Password
          <input
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </label>
        <button disabled={login.isPending} type="submit">
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
        {login.error && <p className="error-text">{login.error.message}</p>}
      </form>
    </main>
  );
}
