'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { StatusBadge } from './AdminPrimitives';
import { useAdminSession } from './AdminSession';
import { API_URL } from './admin-environment';
import type { StaffAccessOptions, StaffAccount } from './StaffManagementPanel';

interface Envelope<T> {
  readonly data?: T;
  readonly error?: { readonly message: string };
}

export function StaffDetailPanel({ id }: { readonly id: string }) {
  const { accessToken, logout } = useAdminSession();
  const request = async <T,>(path: string, init: RequestInit = {}) => {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    });
    const body = (await response.json()) as Envelope<T>;
    if (response.status === 401) logout();
    if (!response.ok || !body.data) throw new Error(body.error?.message ?? 'Request failed.');
    return body.data;
  };
  const account = useQuery({
    queryKey: ['admin-staff-detail', id],
    queryFn: () => request<StaffAccount>(`/admin/staff/${id}`),
  });
  const options = useQuery({
    queryKey: ['admin-staff-permissions'],
    queryFn: () => request<StaffAccessOptions>('/admin/staff/permissions'),
  });
  if (account.error || options.error)
    return <p className="error-text">{account.error?.message ?? options.error?.message}</p>;
  if (!account.data || !options.data) return <p>Loading staff access…</p>;

  return <StaffDetailForm account={account.data} options={options.data} request={request} />;
}

function StaffDetailForm({
  account,
  options,
  request,
}: {
  readonly account: StaffAccount;
  readonly options: StaffAccessOptions;
  readonly request: <T>(path: string, init?: RequestInit) => Promise<T>;
}) {
  const { admin } = useAdminSession();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(account.displayName);
  const [role, setRole] = useState<'STAFF' | 'SUPER_ADMIN'>(
    account.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'STAFF',
  );
  const [selected, setSelected] = useState<string[]>(
    account.permissions.map(({ permission }) => permission.code),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await request(`/admin/staff/${account.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName, role, permissions: selected }),
      });
      router.push('/admin/staff');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update staff access.');
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="staff-create-layout" onSubmit={(event) => void submit(event)}>
      <section className="admin-card staff-create-section">
        <div className="admin-section-heading">
          <div>
            <span className="eyebrow">STAFF DETAILS</span>
            <h2>{account.displayName}</h2>
            <p>{account.email}</p>
          </div>
          <StatusBadge
            value={account.status}
            label={account.status.toLowerCase().replace(/^./, (value) => value.toUpperCase())}
          />
        </div>
        <div className="staff-field-grid">
          <label className="admin-field">
            Display name
            <input
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label className="admin-field">
            Access level
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as 'STAFF' | 'SUPER_ADMIN')}
            >
              <option value="STAFF">Staff</option>
              {admin.role === 'OWNER' && <option value="SUPER_ADMIN">Super Admin</option>}
            </select>
          </label>
        </div>
      </section>
      <section className="admin-card staff-create-section">
        <span className="eyebrow">PERMISSIONS</span>
        <h2>{selected.length} explicit capabilities</h2>
        <details>
          <summary>Review and customize full permissions</summary>
          <div className="permission-customizer">
            {Object.entries(options.permissions).map(([code, description]) => (
              <label key={code}>
                <input
                  type="checkbox"
                  checked={selected.includes(code)}
                  onChange={() =>
                    setSelected((items) =>
                      items.includes(code)
                        ? items.filter((item) => item !== code)
                        : [...items, code],
                    )
                  }
                />
                <span>
                  <strong>{description}</strong>
                  <small>{code}</small>
                </span>
              </label>
            ))}
          </div>
        </details>
      </section>
      {error && <p className="error-text">{error}</p>}
      <div className="staff-create-actions">
        <button disabled={pending} type="submit">
          {pending ? 'Saving…' : 'Save and revoke existing sessions'}
        </button>
        <button className="quiet" type="button" onClick={() => router.push('/admin/staff')}>
          Cancel
        </button>
      </div>
    </form>
  );
}
