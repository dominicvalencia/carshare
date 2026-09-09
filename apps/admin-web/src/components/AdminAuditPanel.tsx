'use client';

import { useQuery } from '@tanstack/react-query';
import { DataTable, EmptyState } from './AdminPrimitives';
import { useAdminSession } from './AdminSession';
import { API_URL } from './admin-environment';

interface AuditEntry {
  readonly id: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly reason: string | null;
  readonly createdAt: string;
  readonly actor: { readonly id: string; readonly displayName: string; readonly role: string };
  readonly previousState: unknown;
  readonly newState: unknown;
}

export function AdminAuditPanel() {
  const { accessToken, logout } = useAdminSession();
  const audit = useQuery({
    queryKey: ['admin-audit'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/admin/audit`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = (await response.json()) as { data?: AuditEntry[]; error?: { message: string } };
      if (response.status === 401) logout();
      if (!response.ok || !body.data)
        throw new Error(body.error?.message ?? 'Audit history unavailable.');
      return body.data;
    },
  });
  return (
    <section className="admin-card module-section module-audit">
      <span className="eyebrow">ACCOUNTABILITY</span>
      <h2>Administrative audit log</h2>
      <p>Append-only actor attribution with allowlisted status and permission changes.</p>
      {audit.error && <p className="error-text">{audit.error.message}</p>}
      {audit.data?.length ? (
        <DataTable label="Administrative audit history">
          <thead>
            <tr>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Time</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {audit.data.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.actor.displayName}</strong>
                  <br />
                  <small>{item.actor.role.replace('_', ' ')}</small>
                </td>
                <td>{item.action.replaceAll('_', ' ')}</td>
                <td>
                  {item.entityType}
                  <br />
                  <small>{item.entityId}</small>
                </td>
                <td>{new Date(item.createdAt).toLocaleString()}</td>
                <td>{item.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : !audit.isLoading && !audit.error ? (
        <EmptyState
          title="No audit entries"
          description="Sensitive administrative actions will appear here."
        />
      ) : null}
    </section>
  );
}
