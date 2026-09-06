'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { AdminSessionProvider, useAdminSession } from './AdminSession';
import { adminEnvironment } from './admin-environment';

const navigation = [
  { href: '/admin/dashboard', icon: '▦', label: 'Dashboard' },
  { href: '/admin/users', icon: '◎', label: 'Users' },
  { href: '/admin/verification/renters', icon: '✓', label: 'Renter KYC' },
  { href: '/admin/verification/owners', icon: '◇', label: 'Owner verification' },
  { href: '/admin/vehicles', icon: '▱', label: 'Vehicles' },
  { href: '/admin/bookings', icon: '▤', label: 'Bookings' },
  { href: '/admin/rentals', icon: '↔', label: 'Rental operations' },
  { href: '/admin/claims', icon: '⚑', label: 'Claims & disputes' },
  { href: '/admin/payouts', icon: '₱', label: 'Payments & payouts' },
  { href: '/admin/support', icon: '?', label: 'Support' },
  { href: '/admin/trust-safety', icon: '⊙', label: 'Trust & safety' },
  { href: '/admin/operations/inspection-corrections', icon: '↺', label: 'Inspection corrections' },
  { href: '/admin/settings/commissions', icon: '⚙', label: 'Platform settings' },
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
  const { logout } = useAdminSession();
  const [open, setOpen] = useState(false);
  const current = navigation.find(
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
            <strong>Car Rental</strong>
            <small>Operations console</small>
          </span>
        </div>
        <nav aria-label="Administration">
          {navigation.map((item) => {
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
            <span className="identity-avatar">A</span>
            <span>
              <strong>Administrator</strong>
              <small>Authorized session</small>
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
