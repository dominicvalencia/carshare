'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { DataTable, EmptyState, StatusBadge } from './AdminPrimitives';
import { useAdminSession } from './AdminSession';
import { API_URL } from './admin-environment';

interface Envelope<T> {
  readonly data?: T;
  readonly error?: { readonly message: string };
}

export interface StaffAccount {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: 'OWNER' | 'SUPER_ADMIN' | 'STAFF';
  readonly status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  readonly lastLoginAt: string | null;
  readonly invitedAt: string | null;
  readonly activatedAt: string | null;
  readonly createdBy: { readonly displayName: string } | null;
  readonly permissions: readonly { readonly permission: { readonly code: string } }[];
}

export interface StaffAccessOptions {
  readonly permissions: Readonly<Record<string, string>>;
  readonly profiles: Readonly<Record<string, readonly string[]>>;
  readonly superAdminDefaults: readonly string[];
}

const staffStatusLabels: Readonly<Record<StaffAccount['status'], string>> = {
  ACTIVE: 'Active',
  DISABLED: 'Disabled',
  INVITED: 'Invited',
  SUSPENDED: 'Suspended',
};

export function StaffManagementPanel() {
  const { accessToken, admin, can, logout } = useAdminSession();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [invitationMessage, setInvitationMessage] = useState('');
  const api = async <T,>(path: string, init: RequestInit = {}) => {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...init.headers,
      },
    });
    const body = (await response.json()) as Envelope<T>;
    if (response.status === 401) logout();
    if (!response.ok || !body.data) throw new Error(body.error?.message ?? 'Staff request failed.');
    return body.data;
  };
  const staff = useQuery({
    queryKey: ['admin-staff', search, roleFilter, statusFilter],
    queryFn: () => {
      const query = new URLSearchParams();
      if (search.trim()) query.set('query', search.trim());
      if (roleFilter) query.set('role', roleFilter);
      if (statusFilter) query.set('status', statusFilter);
      const suffix = query.size ? `?${query.toString()}` : '';
      return api<StaffAccount[]>(`/admin/staff${suffix}`);
    },
  });
  const permissions = useQuery({
    queryKey: ['admin-staff-permissions'],
    queryFn: () => api<StaffAccessOptions>('/admin/staff/permissions'),
  });
  const action = useMutation({
    mutationFn: ({ id, operation, reason }: { id: string; operation: string; reason?: string }) =>
      api(`/admin/staff/${id}/${operation}`, {
        method: 'POST',
        ...(reason ? { body: JSON.stringify({ reason }) } : {}),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin-staff'] }),
  });
  const copyInvitation = useMutation({
    mutationFn: (id: string) => api<{ url: string }>(`/admin/staff/${id}/local-invitation`),
    onSuccess: async ({ url }) => {
      await navigator.clipboard.writeText(url);
      setInvitationMessage(
        'Local invitation link copied. Share it only with the intended invitee.',
      );
    },
    onError: (cause) =>
      setInvitationMessage(
        cause instanceof Error ? cause.message : 'Unable to retrieve the local invitation.',
      ),
  });
  return (
    <section className="admin-card module-section module-staff">
      <div className="admin-section-heading">
        <div>
          <span className="eyebrow">ACCESS MANAGEMENT</span>
          <h2>Staff accounts</h2>
        </div>
        {can('staff.create') && (
          <Link className="button-link" href="/admin/staff/new">
            Create staff
          </Link>
        )}
      </div>
      <div className="actions" aria-label="Filter staff accounts">
        <label className="admin-field">
          Search
          <input
            type="search"
            placeholder="Name or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="admin-field">
          Role
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="">All roles</option>
            <option value="OWNER">Owner</option>
            <option value="SUPER_ADMIN">Super Admin</option>
            <option value="STAFF">Staff</option>
          </select>
        </label>
        <label className="admin-field">
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">All statuses</option>
            <option value="INVITED">Invited</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="DISABLED">Disabled</option>
          </select>
        </label>
      </div>
      {staff.error && <p className="error-text">{staff.error.message}</p>}
      {invitationMessage && <p className="admin-inline-note">{invitationMessage}</p>}
      {staff.data?.length ? (
        <DataTable label="Administrative staff accounts">
          <thead>
            <tr>
              <th>Staff</th>
              <th>Role</th>
              <th>Status</th>
              <th>Staff profile</th>
              <th>Last login</th>
              <th>Created by</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.data.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.displayName}</strong>
                  <br />
                  <small>{item.email}</small>
                </td>
                <td>{item.role.replace('_', ' ')}</td>
                <td>
                  <StatusBadge value={item.status} label={staffStatusLabels[item.status]} />
                </td>
                <td>{staffProfileLabel(item, permissions.data?.profiles)}</td>
                <td>{item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleString() : 'Never'}</td>
                <td>{item.createdBy?.displayName ?? 'Bootstrap'}</td>
                <td>
                  {item.role !== 'OWNER' && item.id !== admin.id && (
                    <div className="actions">
                      {can('staff.edit') && can('staff.permissions.manage') && (
                        <Link className="button-link compact" href={`/admin/staff/${item.id}`}>
                          Edit access
                        </Link>
                      )}
                      {item.status === 'SUSPENDED' && can('staff.suspend') && (
                        <button
                          className="compact"
                          onClick={() => action.mutate({ id: item.id, operation: 'reactivate' })}
                        >
                          Reactivate
                        </button>
                      )}
                      {item.status === 'ACTIVE' && can('staff.suspend') && (
                        <button
                          className="compact danger"
                          onClick={() =>
                            action.mutate({
                              id: item.id,
                              operation: 'suspend',
                              reason: 'Suspended by authorized administrator',
                            })
                          }
                        >
                          Suspend
                        </button>
                      )}
                      {item.status === 'INVITED' && can('staff.create') && (
                        <>
                          {admin.role === 'OWNER' && (
                            <button
                              className="compact"
                              disabled={copyInvitation.isPending}
                              onClick={() => copyInvitation.mutate(item.id)}
                            >
                              Copy local invite link
                            </button>
                          )}
                          <button
                            className="compact"
                            onClick={() =>
                              action.mutate({ id: item.id, operation: 'resend-invite' })
                            }
                          >
                            Resend invite
                          </button>
                          <button
                            className="compact danger"
                            onClick={() =>
                              action.mutate({ id: item.id, operation: 'revoke-invite' })
                            }
                          >
                            Revoke invite
                          </button>
                        </>
                      )}
                      {item.status !== 'DISABLED' && can('staff.disable') && (
                        <button
                          className="compact danger"
                          onClick={() =>
                            action.mutate({
                              id: item.id,
                              operation: 'disable',
                              reason: 'Disabled by authorized administrator',
                            })
                          }
                        >
                          Disable
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : !staff.isLoading && !staff.error ? (
        <EmptyState
          title="No staff accounts"
          description="Invite the first staff member when operationally required."
        />
      ) : null}
    </section>
  );
}

function staffProfileLabel(
  account: StaffAccount,
  profiles?: Readonly<Record<string, readonly string[]>>,
) {
  if (account.role === 'OWNER') return 'Owner authority';
  if (account.role === 'SUPER_ADMIN') return 'Super Admin';
  const current = [...account.permissions.map(({ permission }) => permission.code)].sort();
  const match = Object.entries(profiles ?? {}).find(
    ([, values]) =>
      [...values].sort().every((value, index) => value === current[index]) &&
      values.length === current.length,
  );
  return match
    ? match[0].replaceAll('_', ' ').replace(/\b\w/g, (value) => value.toUpperCase())
    : 'Custom permissions';
}
