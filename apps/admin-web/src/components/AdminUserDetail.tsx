'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { DataTable, EmptyState, StatusBadge } from './AdminPrimitives';
import { marketplaceRoleLabel } from './admin-presentation';

import { API_URL } from './admin-environment';

interface Envelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { readonly message: string };
}
interface Person {
  readonly email: string | null;
  readonly profile: {
    readonly displayName: string | null;
    readonly firstName: string | null;
    readonly lastName: string | null;
  } | null;
}
interface BookingHistory {
  readonly publicReference: string;
  readonly status: string;
  readonly rentalStart: string;
  readonly rentalEnd: string;
  readonly createdAt: string;
  readonly actualReturnAt: string | null;
  readonly vehicle: {
    readonly id: string;
    readonly make: string | null;
    readonly model: string | null;
    readonly modelYear: number | null;
  };
  readonly pricingSnapshot: { readonly currency: string; readonly totalMinor: number } | null;
  readonly postReturnClaims: readonly { readonly id: string; readonly status: string }[];
  readonly owner?: Person;
  readonly renter?: Person;
  readonly ownerEarning?: {
    readonly currency: string;
    readonly netEarningAmountMinor: string;
    readonly status: string;
  } | null;
}
interface AdminUserDetailRecord {
  readonly _count: { readonly authoredReviews: number; readonly subjectReviews: number };
  readonly id: string;
  readonly email: string | null;
  readonly mobileNumber: string | null;
  readonly emailVerifiedAt: string | null;
  readonly mobileVerifiedAt: string | null;
  readonly createdAt: string;
  readonly lastLoginAt: string | null;
  readonly loginLockedUntil: string | null;
  readonly status: string;
  readonly profile: {
    readonly displayName: string | null;
    readonly firstName: string | null;
    readonly middleName: string | null;
    readonly lastName: string | null;
  } | null;
  readonly roles: readonly { readonly role: { readonly code: string } }[];
  readonly verifications: readonly {
    readonly id: string;
    readonly type: string;
    readonly status: string;
    readonly submittedAt: string | null;
    readonly reviewedAt: string | null;
  }[];
  readonly ownerProfile: {
    readonly _count: { readonly reviews: number };
    readonly id: string;
    readonly legalName: string | null;
    readonly status: string;
    readonly createdAt: string;
    readonly submittedAt: string | null;
    readonly verifiedAt: string | null;
    readonly payoutEligibility: { readonly status: string } | null;
    readonly publicReference: string;
  } | null;
  readonly ownedVehicles: readonly {
    readonly id: string;
    readonly make: string | null;
    readonly model: string | null;
    readonly modelYear: number | null;
    readonly status: string;
    readonly operationalStatus: string;
    readonly createdAt: string;
    readonly category: { readonly name: string } | null;
  }[];
  readonly renterBookings: readonly BookingHistory[];
  readonly ownerBookings: readonly BookingHistory[];
}

const displayName = (person: Person | null | undefined) =>
  person?.profile?.displayName ??
  [person?.profile?.firstName, person?.profile?.lastName].filter(Boolean).join(' ') ??
  person?.email ??
  'Unknown';
const vehicleName = (booking: BookingHistory) =>
  [booking.vehicle.modelYear, booking.vehicle.make, booking.vehicle.model]
    .filter(Boolean)
    .join(' ');
const money = (currency: string, minor: number | string) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(Number(minor) / 100);

export function AdminUserDetail({
  accessToken,
  onUnauthorized,
  userId,
}: {
  readonly accessToken: string;
  readonly onUnauthorized: () => void;
  readonly userId: string;
}) {
  const [bookingFilter, setBookingFilter] = useState('ALL');
  const [activeTab, setActiveTab] = useState<'overview' | 'renter' | 'owner' | 'security'>(
    'overview',
  );
  const detail = useQuery({
    queryKey: ['admin-user', userId],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/admin/users/${userId}`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const envelope = (await response.json()) as Envelope<AdminUserDetailRecord>;
      if (response.status === 401) {
        onUnauthorized();
        throw new Error('Your administrative session expired. Sign in again.');
      }
      if (!response.ok || !envelope.data)
        throw new Error(envelope.error?.message ?? 'Unable to load this account.');
      return envelope.data;
    },
  });
  if (detail.isLoading) return <div className="state-panel">Loading account workspace…</div>;
  if (detail.error) return <div className="state-panel error-text">{detail.error.message}</div>;
  const user = detail.data;
  if (!user) return null;
  const roles = user.roles.map(({ role }) => role.code);
  const name =
    user.profile?.displayName ??
    [user.profile?.firstName, user.profile?.middleName, user.profile?.lastName]
      .filter(Boolean)
      .join(' ') ??
    user.email ??
    user.mobileNumber ??
    'Unnamed account';
  const kyc = user.verifications.find((item) => item.type.includes('RENTER'));
  const filteredRenterBookings = user.renterBookings.filter(
    (booking) => bookingFilter === 'ALL' || booking.status === bookingFilter,
  );
  const renterCounts = lifecycleCounts(user.renterBookings);
  const ownerCounts = lifecycleCounts(user.ownerBookings);
  const allClaims = [...user.renterBookings, ...user.ownerBookings].flatMap(
    (booking) => booking.postReturnClaims,
  );
  return (
    <section className="account-workspace">
      <div className="detail-hero">
        <div>
          <Link className="back-link" href="/admin/users">
            ← Accounts
          </Link>
          <h2>{name}</h2>
          <p>{roles.map(marketplaceRoleLabel).join(' • ') || 'No marketplace role assigned'}</p>
        </div>
        <StatusBadge value={user.status} />
      </div>
      <div className="summary-strip">
        <Summary
          label="Email"
          value={user.email ?? 'Not provided'}
          verified={Boolean(user.emailVerifiedAt)}
        />
        <Summary
          label="Mobile"
          value={user.mobileNumber ?? 'Not provided'}
          verified={Boolean(user.mobileVerifiedAt)}
        />
        <Summary label="Member since" value={new Date(user.createdAt).toLocaleDateString()} />
        <Summary
          label="Last login"
          value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}
        />
      </div>
      <nav aria-label="Account workspace" className="detail-tabs">
        <Tab active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>
          Overview
        </Tab>
        {roles.includes('RENTER') && (
          <Tab active={activeTab === 'renter'} onClick={() => setActiveTab('renter')}>
            Renter activity
          </Tab>
        )}
        {roles.includes('OWNER') && (
          <Tab active={activeTab === 'owner'} onClick={() => setActiveTab('owner')}>
            Owner activity
          </Tab>
        )}
        <Tab active={activeTab === 'security'} onClick={() => setActiveTab('security')}>
          Security
        </Tab>
      </nav>
      {activeTab === 'overview' && (
        <div className="detail-columns">
          <section className="compact-panel">
            <h3>Account overview</h3>
            <dl className="definition-list">
              <div>
                <dt>Roles</dt>
                <dd>{roles.join(', ') || 'None'}</dd>
              </div>
              <div>
                <dt>Security</dt>
                <dd>
                  {user.loginLockedUntil
                    ? `Locked until ${new Date(user.loginLockedUntil).toLocaleString()}`
                    : 'No active login lock'}
                </dd>
              </div>
              <div>
                <dt>Renter KYC</dt>
                <dd>{kyc ? <StatusBadge value={kyc.status} /> : 'Not submitted'}</dd>
              </div>
              <div>
                <dt>Owner verification</dt>
                <dd>
                  {user.ownerProfile ? (
                    <StatusBadge value={user.ownerProfile.status} />
                  ) : (
                    'Not an owner'
                  )}
                </dd>
              </div>
            </dl>
            {kyc && (
              <Link className="button-link" href={`/admin/verification/renters/${kyc.id}`}>
                Open secure verification workspace
              </Link>
            )}
          </section>
          <section className="compact-panel">
            <h3>Operational summary</h3>
            <div className="mini-metrics">
              <Summary label="Renter bookings" value={String(user.renterBookings.length)} />
              <Summary label="Owned vehicles" value={String(user.ownedVehicles.length)} />
              <Summary label="Owner bookings" value={String(user.ownerBookings.length)} />
              <Summary label="Reviews written" value={String(user._count.authoredReviews)} />
              <Summary
                label="Reviews received"
                value={String(
                  user._count.subjectReviews + (user.ownerProfile?._count.reviews ?? 0),
                )}
              />
              <Summary
                label="Open claims"
                value={String(
                  allClaims.filter(
                    (claim) => !['RESOLVED', 'REJECTED', 'WITHDRAWN'].includes(claim.status),
                  ).length,
                )}
              />
            </div>
          </section>
        </div>
      )}
      {activeTab === 'security' && (
        <section className="workspace-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">SECURITY</span>
              <h3>Account access status</h3>
            </div>
          </div>
          <dl className="definition-list">
            <div>
              <dt>Account status</dt>
              <dd>
                <StatusBadge value={user.status} />
              </dd>
            </div>
            <div>
              <dt>Last successful login</dt>
              <dd>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}</dd>
            </div>
            <div>
              <dt>Login lock</dt>
              <dd>
                {user.loginLockedUntil
                  ? `Locked until ${new Date(user.loginLockedUntil).toLocaleString()}`
                  : 'No active login lock'}
              </dd>
            </div>
            <div>
              <dt>Email verification</dt>
              <dd>
                {user.emailVerifiedAt
                  ? new Date(user.emailVerifiedAt).toLocaleString()
                  : 'Not verified'}
              </dd>
            </div>
            <div>
              <dt>Mobile verification</dt>
              <dd>
                {user.mobileVerifiedAt
                  ? new Date(user.mobileVerifiedAt).toLocaleString()
                  : 'Not verified'}
              </dd>
            </div>
          </dl>
          <p className="privacy-note">
            Detailed security and audit events remain permission-scoped and are not automatically
            exposed by the general account endpoint.
          </p>
        </section>
      )}
      {roles.includes('RENTER') && activeTab === 'renter' && (
        <section className="workspace-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">RENTER ACTIVITY</span>
              <h3>Booking and rental history</h3>
            </div>
            <label>
              Lifecycle
              <select
                value={bookingFilter}
                onChange={(event) => setBookingFilter(event.target.value)}
              >
                <option value="ALL">All</option>
                {[
                  'CONFIRMED',
                  'READY_FOR_PICKUP',
                  'ACTIVE',
                  'RETURN_PENDING',
                  'RETURNED',
                  'COMPLETED',
                  'CANCELLED',
                  'EXPIRED',
                ].map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="operational-metrics">
            <Summary label="Total bookings" value={String(user.renterBookings.length)} />
            <Summary label="Upcoming" value={String(renterCounts.upcoming)} />
            <Summary label="Active" value={String(renterCounts.active)} />
            <Summary label="Completed" value={String(renterCounts.completed)} />
            <Summary label="Cancelled / expired" value={String(renterCounts.cancelled)} />
            <Summary
              label="Claims"
              value={String(
                user.renterBookings.flatMap((booking) => booking.postReturnClaims).length,
              )}
            />
          </div>
          {filteredRenterBookings.length ? (
            <BookingTable bookings={filteredRenterBookings} perspective="renter" />
          ) : (
            <EmptyState
              title="No matching renter bookings"
              description="No authoritative booking records match this lifecycle filter."
            />
          )}
        </section>
      )}
      {roles.includes('OWNER') && activeTab === 'owner' && (
        <>
          <section className="workspace-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">OWNER OVERVIEW</span>
                <h3>Operational summary</h3>
              </div>
              {user.ownerProfile && <StatusBadge value={user.ownerProfile.status} />}
            </div>
            <div className="operational-metrics">
              <Summary label="Vehicles" value={String(user.ownedVehicles.length)} />
              <Summary
                label="Approved"
                value={String(
                  user.ownedVehicles.filter((vehicle) => vehicle.status === 'APPROVED').length,
                )}
              />
              <Summary
                label="Pending review"
                value={String(
                  user.ownedVehicles.filter((vehicle) =>
                    ['PENDING_APPROVAL', 'SUBMITTED'].includes(vehicle.status),
                  ).length,
                )}
              />
              <Summary label="Active rentals" value={String(ownerCounts.active)} />
              <Summary label="Completed rentals" value={String(ownerCounts.completed)} />
              <Summary
                label="Claims"
                value={String(
                  user.ownerBookings.flatMap((booking) => booking.postReturnClaims).length,
                )}
              />
            </div>
          </section>
          <section className="workspace-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">OWNER ACTIVITY</span>
                <h3>Vehicles</h3>
              </div>
              {user.ownerProfile && <StatusBadge value={user.ownerProfile.status} />}
            </div>
            {user.ownedVehicles.length ? (
              <DataTable label="Owner vehicles">
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Category</th>
                    <th>Review state</th>
                    <th>Availability</th>
                    <th>Created</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {user.ownedVehicles.map((vehicle) => (
                    <tr key={vehicle.id}>
                      <td>
                        <strong>
                          {[vehicle.modelYear, vehicle.make, vehicle.model]
                            .filter(Boolean)
                            .join(' ') || 'Incomplete vehicle'}
                        </strong>
                      </td>
                      <td>{vehicle.category?.name ?? '—'}</td>
                      <td>
                        <StatusBadge value={vehicle.status} />
                      </td>
                      <td>
                        <StatusBadge value={vehicle.operationalStatus} />
                      </td>
                      <td>{new Date(vehicle.createdAt).toLocaleDateString()}</td>
                      <td>
                        <Link href={`/admin/vehicles/${vehicle.id}`}>Review</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : (
              <EmptyState
                title="No owner vehicles"
                description="This owner has not created any vehicle records."
              />
            )}
          </section>
          <section className="workspace-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">OWNER ACTIVITY</span>
                <h3>Booking and rental history</h3>
              </div>
              {user.ownerProfile?.payoutEligibility && (
                <StatusBadge value={user.ownerProfile.payoutEligibility.status} />
              )}
            </div>
            {user.ownerBookings.length ? (
              <BookingTable bookings={user.ownerBookings} perspective="owner" />
            ) : (
              <EmptyState
                title="No owner rental history"
                description="No bookings currently involve this owner's vehicles."
              />
            )}
          </section>
        </>
      )}
    </section>
  );
}

function Summary({
  label,
  value,
  verified,
}: {
  readonly label: string;
  readonly value: string;
  readonly verified?: boolean;
}) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
      {verified !== undefined && <small>{verified ? 'Verified' : 'Not verified'}</small>}
    </div>
  );
}

function Tab({
  active,
  children,
  onClick,
}: {
  readonly active: boolean;
  readonly children: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className={active ? 'active' : ''}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {children}
    </button>
  );
}

function lifecycleCounts(bookings: readonly BookingHistory[]) {
  return {
    active: bookings.filter((booking) =>
      ['READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING', 'RETURNED'].includes(booking.status),
    ).length,
    cancelled: bookings.filter((booking) => ['CANCELLED', 'EXPIRED'].includes(booking.status))
      .length,
    completed: bookings.filter((booking) => booking.status === 'COMPLETED').length,
    upcoming: bookings.filter((booking) =>
      ['HOLD', 'AWAITING_PAYMENT', 'AWAITING_OWNER', 'CAPTURE_PENDING', 'CONFIRMED'].includes(
        booking.status,
      ),
    ).length,
  };
}

function BookingTable({
  bookings,
  perspective,
}: {
  readonly bookings: readonly BookingHistory[];
  readonly perspective: 'owner' | 'renter';
}) {
  return (
    <DataTable label={`${perspective} booking history`}>
      <thead>
        <tr>
          <th>Booking</th>
          <th>Vehicle</th>
          <th>{perspective === 'renter' ? 'Owner' : 'Renter'}</th>
          <th>Rental period</th>
          <th>Status</th>
          <th>Total</th>
          {perspective === 'owner' && <th>Owner earning</th>}
          <th>Claims</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {bookings.map((booking) => (
          <tr key={booking.publicReference}>
            <td>
              <Link href={`/admin/bookings/${booking.publicReference}`}>
                <strong>{booking.publicReference}</strong>
              </Link>
              <small>{new Date(booking.createdAt).toLocaleDateString()}</small>
            </td>
            <td>{vehicleName(booking)}</td>
            <td>{displayName(perspective === 'renter' ? booking.owner : booking.renter)}</td>
            <td>
              {new Date(booking.rentalStart).toLocaleDateString()} –{' '}
              {new Date(booking.rentalEnd).toLocaleDateString()}
            </td>
            <td>
              <StatusBadge value={booking.status} />
            </td>
            <td>
              {booking.pricingSnapshot
                ? money(booking.pricingSnapshot.currency, booking.pricingSnapshot.totalMinor)
                : '—'}
            </td>
            {perspective === 'owner' && (
              <td>
                {booking.ownerEarning ? (
                  <>
                    {money(
                      booking.ownerEarning.currency,
                      booking.ownerEarning.netEarningAmountMinor,
                    )}
                    <small>{booking.ownerEarning.status}</small>
                  </>
                ) : (
                  '—'
                )}
              </td>
            )}
            <td>
              {booking.postReturnClaims.length ? (
                <div className="claim-links">
                  {booking.postReturnClaims.map((claim) => (
                    <Link href={`/admin/claims/${claim.id}`} key={claim.id}>
                      {claim.status.replaceAll('_', ' ')}
                    </Link>
                  ))}
                </div>
              ) : (
                'None'
              )}
            </td>
            <td>
              <div className="table-actions">
                <Link href={`/admin/bookings/${booking.publicReference}`}>Booking</Link>
                {['READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING', 'RETURNED', 'COMPLETED'].includes(
                  booking.status,
                ) && <Link href={`/admin/rentals/${booking.publicReference}`}>Rental</Link>}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
