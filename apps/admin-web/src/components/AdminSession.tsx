'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from 'react';

import { API_URL } from './admin-environment';

interface Envelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { readonly message: string };
}

interface AdminSessionValue {
  readonly accessToken: string;
  readonly admin: AdminIdentity;
  readonly can: (permission: string) => boolean;
  readonly logout: () => void;
}

export interface AdminIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: 'OWNER' | 'SUPER_ADMIN' | 'STAFF';
  readonly status: string;
  readonly permissions: readonly string[];
}

interface AuthenticatedAdmin {
  readonly accessToken: string;
  readonly admin: AdminIdentity;
}

const AdminSessionContext = createContext<AdminSessionValue | null>(null);

export function AdminSessionProvider({ children }: { readonly children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<AuthenticatedAdmin | null>(null);
  const queryClient = useQueryClient();
  const value = useMemo(
    () => ({
      accessToken: authenticated?.accessToken ?? '',
      admin: authenticated?.admin as AdminIdentity,
      can: (permission: string) => authenticated?.admin.permissions.includes(permission) ?? false,
      logout: () => {
        if (authenticated?.accessToken)
          void fetch(`${API_URL}/admin/auth/logout`, {
            headers: { Authorization: `Bearer ${authenticated.accessToken}` },
            method: 'POST',
          });
        setAuthenticated(null);
        queryClient.clear();
      },
    }),
    [authenticated, queryClient],
  );
  if (!authenticated) return <AdminLogin onAuthenticated={setAuthenticated} />;
  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession() {
  const session = useContext(AdminSessionContext);
  if (!session) throw new Error('Admin session is unavailable.');
  return session;
}

function AdminLogin({
  onAuthenticated,
}: {
  readonly onAuthenticated: (value: AuthenticatedAdmin) => void;
}) {
  const router = useRouter();
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
      const envelope = (await response.json()) as Envelope<AuthenticatedAdmin>;
      if (!response.ok || !envelope.data)
        throw new Error(envelope.error?.message ?? 'Login failed.');
      return envelope.data;
    },
    onSuccess: (session) => {
      onAuthenticated(session);
      router.push(session.admin.role === 'OWNER' ? '/admin/owner/overview' : '/admin/dashboard');
    },
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
