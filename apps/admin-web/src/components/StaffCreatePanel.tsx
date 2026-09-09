'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useState } from 'react';
import { useAdminSession } from './AdminSession';
import { API_URL } from './admin-environment';
import type { StaffAccessOptions } from './StaffManagementPanel';

interface Envelope<T> {
  readonly data?: T;
  readonly error?: { readonly message: string };
}

const profileDescriptions: Readonly<Record<string, string>> = {
  OPERATIONS_STAFF: 'Marketplace operations, verification, rentals, claims, and support.',
  VERIFICATION_STAFF: 'Renter, owner, and vehicle verification workflows.',
  SUPPORT_STAFF: 'Customer accounts, bookings, claims visibility, and support workflows.',
  FINANCE_STAFF: 'Payment, earnings, refund, and payout visibility with scoped refund approval.',
};

const categoryLabels: Readonly<Record<string, string>> = {
  additional_charges: 'Additional charges',
  audit: 'Audit',
  claims: 'Claims',
  commissions: 'Commission settings',
  disputes: 'Disputes',
  earnings: 'Earnings',
  incidents: 'Incidents',
  inspections: 'Inspections',
  messages: 'Messages',
  moderation: 'Moderation',
  owners: 'Owners',
  payments: 'Payments',
  payout_accounts: 'Payout accounts',
  payouts: 'Payouts',
  refunds: 'Refunds',
  rentals: 'Rentals and bookings',
  renters: 'Renter verification',
  reviews: 'Reviews',
  staff: 'Staff administration',
  support: 'Support',
  users: 'Users',
  vehicles: 'Vehicles',
};

export function StaffCreatePanel() {
  const { accessToken, admin, logout } = useAdminSession();
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'STAFF' | 'SUPER_ADMIN'>('STAFF');
  const [profile, setProfile] = useState('OPERATIONS_STAFF');
  const [selected, setSelected] = useState<string[] | null>(null);
  const [customized, setCustomized] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const request = async <T,>(path: string, init: RequestInit = {}) => {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const body = (await response.json()) as Envelope<T>;
    if (response.status === 401) logout();
    if (!response.ok || !body.data) throw new Error(body.error?.message ?? 'Request failed.');
    return body.data;
  };

  const options = useQuery({
    queryKey: ['admin-staff-permissions'],
    queryFn: () => request<StaffAccessOptions>('/admin/staff/permissions'),
  });

  const effectiveSelected = useMemo(
    () =>
      selected
        ? selected
        : role === 'SUPER_ADMIN'
          ? [...(options.data?.superAdminDefaults ?? [])]
          : [...(options.data?.profiles[profile] ?? [])],
    [options.data, profile, role, selected],
  );

  const grouped = useMemo(() => {
    const result = new Map<string, Array<{ code: string; description: string }>>();
    for (const code of effectiveSelected) {
      const category = code.split('.')[0] ?? 'other';
      const items = result.get(category) ?? [];
      items.push({ code, description: options.data?.permissions[code] ?? code });
      result.set(category, items);
    }
    return result;
  }, [effectiveSelected, options.data]);

  const replaceSelection = (nextRole: 'STAFF' | 'SUPER_ADMIN', nextProfile = profile) => {
    if (customized && !window.confirm('Replace your custom permissions with the recommended set?'))
      return false;
    setRole(nextRole);
    setProfile(nextProfile);
    setSelected(
      nextRole === 'SUPER_ADMIN'
        ? [...(options.data?.superAdminDefaults ?? [])]
        : [...(options.data?.profiles[nextProfile] ?? [])],
    );
    setCustomized(false);
    return true;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await request('/admin/staff', {
        method: 'POST',
        body: JSON.stringify({ displayName, email, role, permissions: effectiveSelected }),
      });
      router.push('/admin/staff');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to send the invitation.');
    } finally {
      setPending(false);
    }
  };

  if (options.error) return <p className="error-text">{options.error.message}</p>;
  if (!options.data) return <p>Loading access profiles…</p>;

  return (
    <form className="staff-create-layout" onSubmit={(event) => void submit(event)}>
      <section className="admin-card staff-create-section">
        <span className="eyebrow">STAFF INFORMATION</span>
        <h2>Who are you inviting?</h2>
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
            Email
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="admin-card staff-create-section">
        <span className="eyebrow">ACCESS LEVEL</span>
        <h2>Choose administrative scope</h2>
        <div className="access-card-grid">
          {admin.role === 'OWNER' && (
            <button
              className={`access-card ${role === 'SUPER_ADMIN' ? 'selected' : ''}`}
              type="button"
              onClick={() => replaceSelection('SUPER_ADMIN')}
            >
              <strong>Super Admin</strong>
              <span>
                Broad operational authority and staff management, excluding OWNER controls.
              </span>
            </button>
          )}
          <button
            className={`access-card ${role === 'STAFF' ? 'selected' : ''}`}
            type="button"
            onClick={() => replaceSelection('STAFF')}
          >
            <strong>Staff</strong>
            <span>Explicitly scoped access initialized from a practical staff profile.</span>
          </button>
        </div>
      </section>

      {role === 'STAFF' && (
        <section className="admin-card staff-create-section">
          <span className="eyebrow">STAFF PROFILE</span>
          <h2>Start from recommended permissions</h2>
          <div className="profile-card-grid">
            {Object.keys(profileDescriptions).map((key) => (
              <button
                className={`access-card ${profile === key && !customized ? 'selected' : ''}`}
                key={key}
                type="button"
                onClick={() => replaceSelection('STAFF', key)}
              >
                <strong>
                  {key.replaceAll('_', ' ').replace(/\b\w/g, (value) => value.toUpperCase())}
                </strong>
                <span>{profileDescriptions[key]}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="admin-card staff-create-section">
        <div className="admin-section-heading">
          <div>
            <span className="eyebrow">PERMISSIONS SUMMARY</span>
            <h2>
              {customized
                ? 'Custom permissions'
                : role === 'SUPER_ADMIN'
                  ? 'Super Admin defaults'
                  : 'Profile permissions'}
            </h2>
          </div>
          <span className="permission-count">{effectiveSelected.length} capabilities</span>
        </div>
        <div className="permission-summary-grid">
          {[...grouped.entries()].map(([category, items]) => (
            <div className="permission-summary-card" key={category}>
              <strong>{categoryLabels[category] ?? category}</strong>
              <span>{items.length} selected</span>
            </div>
          ))}
        </div>
        <button className="quiet" type="button" onClick={() => setAdvanced((value) => !value)}>
          {advanced ? 'Hide permission customization' : 'Customize permissions'}
        </button>
        {advanced && (
          <div className="permission-customizer">
            {Object.entries(options.data.permissions).map(([code, description]) => (
              <label key={code}>
                <input
                  type="checkbox"
                  checked={effectiveSelected.includes(code)}
                  onChange={() => {
                    setSelected((current) => {
                      const source = current ?? effectiveSelected;
                      return source.includes(code)
                        ? source.filter((item) => item !== code)
                        : [...source, code];
                    });
                    setCustomized(true);
                  }}
                />
                <span>
                  <strong>{description}</strong>
                  <small>{code}</small>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      {error && <p className="error-text">{error}</p>}
      <div className="staff-create-actions">
        <button type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Send invitation'}
        </button>
        <button className="quiet" type="button" onClick={() => router.push('/admin/staff')}>
          Cancel
        </button>
      </div>
    </form>
  );
}
