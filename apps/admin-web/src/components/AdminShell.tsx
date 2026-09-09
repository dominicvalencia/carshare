'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { AdminSessionProvider, useAdminSession } from './AdminSession';
import { adminEnvironment } from './admin-environment';

const navigation = [
  { href: '/admin/dashboard', icon: '▦', label: 'Dashboard', permission: null },
  { href: '/admin/users', icon: '◎', label: 'Users', permission: 'users.read' },
  {
    href: '/admin/verification/renters',
    icon: '✓',
    label: 'Renter KYC',
    permission: 'renters.verifications.read',
  },
  {
    href: '/admin/verification/owners',
    icon: '◇',
    label: 'Owner verification',
    permission: 'owners.read',
  },
  { href: '/admin/vehicles', icon: '▱', label: 'Vehicles', permission: 'vehicles.read' },
  { href: '/admin/bookings', icon: '▤', label: 'Bookings', permission: 'rentals.read' },
  { href: '/admin/rentals', icon: '↔', label: 'Rental operations', permission: 'rentals.read' },
  { href: '/admin/claims', icon: '⚑', label: 'Claims & disputes', permission: 'claims.read' },
  { href: '/admin/payouts', icon: '₱', label: 'Payments & payouts', permission: 'payouts.read' },
  { href: '/admin/support', icon: '?', label: 'Support', permission: 'support.read' },
  {
    href: '/admin/trust-safety',
    icon: '⊙',
    label: 'Trust & safety',
    permission: 'moderation.read',
  },
  {
    href: '/admin/operations/inspection-corrections',
    icon: '↺',
    label: 'Inspection corrections',
    permission: 'inspections.read',
  },
  {
    href: '/admin/settings/commissions',
    icon: '⚙',
    label: 'Platform settings',
    permission: 'commissions.read',
  },
  { href: '/admin/staff', icon: '♙', label: 'Staff management', permission: 'staff.view' },
  { href: '/admin/audit', icon: '◷', label: 'Audit log', permission: 'audit.read' },
] as const;

const ownerNavigation = [
  { href: '/admin/owner/overview', icon: '◫', label: 'Overview', permission: null },
  {
    href: '/admin/owner/finance',
    icon: '₱',
    label: 'Revenue & earnings',
    permission: 'payouts.read',
  },
  {
    href: '/admin/owner/bookings-rentals',
    icon: '↔',
    label: 'Bookings & rentals',
    permission: 'rentals.read',
  },
  {
    href: '/admin/owner/users-vehicles',
    icon: '◎',
    label: 'Users & vehicles',
    permission: 'users.read',
  },
  { href: '/admin/owner/reports', icon: '▤', label: 'Reports', permission: null },
  {
    href: '/admin/owner/staff-activity',
    icon: '♙',
    label: 'Staff activity',
    permission: 'audit.read',
  },
  { href: '/admin/staff', icon: '♧', label: 'Staff management', permission: 'staff.view' },
  {
    href: '/admin/owner/audit-security',
    icon: '◷',
    label: 'Audit & security',
    permission: 'audit.read',
  },
  {
    href: '/admin/owner/business-settings',
    icon: '⚙',
    label: 'Business settings',
    permission: 'commissions.read',
  },
] as const;

export function AdminShell({ children }: { readonly children: ReactNode }) {
  return (
    <AdminSessionProvider>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </AdminSessionProvider>
  );
}

function AuthenticatedShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const { admin, can, logout } = useAdminSession();
  const [open, setOpen] = useState(false);
  const operationsMode = pathname.startsWith('/admin/operations-console');
  const ownerMode = admin.role === 'OWNER' && !operationsMode;
  const visibleNavigation = ownerMode
    ? ownerNavigation
    : navigation.map((item) => ({
        ...item,
        href:
          admin.role === 'OWNER'
            ? item.href.replace('/admin/', '/admin/operations-console/')
            : item.href,
      }));
  const current = visibleNavigation.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return (
    <div className="admin-app-shell">
      <button
        aria-label="Close navigation"
        className={`nav-scrim ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(false)}
      />
      <aside className={`admin-sidebar ${open ? 'is-open' : ''}`}>
        <div className="admin-brand">
          <span className="brand-mark">CR</span>
          <span>
            <strong>CarShare</strong>
            <small>{ownerMode ? 'Owner workspace' : 'Operations console'}</small>
          </span>
        </div>
        <nav aria-label="Administration">
          {visibleNavigation
            .filter((item) => !item.permission || can(item.permission))
            .map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  aria-current={active ? 'page' : undefined}
                  className={active ? 'active' : ''}
                  href={item.href}
                  key={item.href}
                  onClick={() => setOpen(false)}
                >
                  <span aria-hidden>{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
        </nav>
        {admin.role === 'OWNER' && (
          <Link
            className="console-switch"
            href={ownerMode ? '/admin/operations-console/dashboard' : '/admin/owner/overview'}
            onClick={() => setOpen(false)}
          >
            <span aria-hidden>{ownerMode ? '↗' : '←'}</span>
            {ownerMode ? 'Operations Console' : 'Return to Owner view'}
          </Link>
        )}
        <div className="sidebar-footer">
          <span>Secure admin workspace</span>
          <small>
            {adminEnvironment.label} · {adminEnvironment.releaseVersion}
          </small>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-header">
          <button
            aria-label="Open navigation"
            className="menu-button"
            onClick={() => setOpen(true)}
          >
            ☰
          </button>
          <div>
            <span className="header-kicker">ADMINISTRATION</span>
            <strong>{current?.label ?? 'Operations'}</strong>
          </div>
          <div className="admin-identity">
            <span className="identity-avatar">{admin.displayName.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{admin.displayName}</strong>
              <small>{admin.role.replace('_', ' ')}</small>
            </span>
            <button className="quiet compact" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
