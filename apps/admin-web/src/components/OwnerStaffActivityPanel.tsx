'use client';

import { useQuery } from '@tanstack/react-query';
import { DataTable, EmptyState } from './AdminPrimitives';
import { useAdminSession } from './AdminSession';
import { API_URL } from './admin-environment';
import { formatDate } from './admin-presentation';

interface AuditEntry {
  readonly id: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly createdAt: string;
  readonly actor: { readonly displayName: string; readonly role: string };
}

export function OwnerStaffActivityPanel() {
  const { accessToken, logout } = useAdminSession();
  const activity = useQuery({
    queryKey: ['owner-staff-activity'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/admin/audit`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = (await response.json()) as {
        data?: readonly AuditEntry[];
        error?: { message: string };
      };
      if (response.status === 401) logout();
      if (!response.ok || !body.data)
        throw new Error(body.error?.message ?? 'Unable to load staff activity.');
      return body.data;
    },
  });

  return (
    <section className="admin-card owner-foundation-panel">
      <div className="admin-section-heading">
        <div>
          <span className="eyebrow">IMMUTABLE ACTIVITY</span>
          <h2>Recent staff actions</h2>
          <p>Factual audited events only. CarShare does not calculate productivity scores.</p>
        </div>
      </div>
      {activity.isLoading && <p>Loading audited activity…</p>}
      {activity.error && <p className="error-text">{activity.error.message}</p>}
      {activity.data?.length === 0 && (
        <EmptyState
          title="No staff activity yet"
          description="Audited staff actions will appear here."
        />
      )}
      {activity.data && activity.data.length > 0 && (
        <DataTable label="Recent administrative staff activity">
          <thead>
            <tr>
              <th>Staff member</th>
              <th>Role</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {activity.data.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.actor.displayName}</td>
                <td>{entry.actor.role.replaceAll('_', ' ')}</td>
                <td>{entry.action.replaceAll('_', ' ')}</td>
                <td>
                  {entry.entityType.replaceAll('_', ' ')} · {entry.entityId.slice(0, 8)}
                </td>
                <td>{formatDate(entry.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}
