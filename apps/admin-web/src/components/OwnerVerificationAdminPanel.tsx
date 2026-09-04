'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  AdminActionBar,
  AdminDefinitionList,
  AdminDetailHeader,
  AdminEvidenceCard,
  AdminSection,
  AdminSummaryCard,
  AdminSummaryGrid,
  AdminTimeline,
  DataTable,
  EmptyState,
  StatusBadge,
} from './AdminPrimitives';
import { adminLabel, formatDate } from './admin-presentation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
interface Envelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { readonly message: string };
}
interface OwnerSummary {
  readonly id: string;
  readonly status: string;
  readonly legalName: string | null;
  readonly submittedAt: string | null;
  readonly user: {
    readonly email: string | null;
    readonly profile: { readonly displayName: string | null } | null;
  };
}
interface OwnerDetail extends OwnerSummary {
  readonly contactNumber: string | null;
  readonly addressLine1: string | null;
  readonly barangay: string | null;
  readonly city: string | null;
  readonly province: string | null;
  readonly postalCode: string | null;
  readonly verifiedAt: string | null;
  readonly rejectedAt: string | null;
  readonly suspendedAt: string | null;
  readonly rejectionReason: string | null;
  readonly suspensionReason: string | null;
  readonly user: OwnerSummary['user'] & {
    readonly mobileNumber: string | null;
    readonly emailVerifiedAt: string | null;
    readonly mobileVerifiedAt: string | null;
    readonly createdAt: string;
  };
  readonly verifications: readonly {
    readonly id: string;
    readonly status: string;
    readonly submittedAt: string | null;
    readonly reviewedAt: string | null;
    readonly rejectionReason: string | null;
    readonly documents: readonly {
      readonly id: string;
      readonly documentType: string;
      readonly status: string;
      readonly fileAsset: { readonly id: string; readonly mimeType: string };
    }[];
  }[];
}

export function OwnerVerificationAdminPanel({
  accessToken,
  initialSelectedId,
  onUnauthorized,
}: {
  readonly accessToken: string;
  readonly initialSelectedId?: string;
  readonly onUnauthorized: () => void;
}) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const api = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...init.headers,
      },
    });
    const envelope = (await response.json()) as Envelope<T>;
    if (response.status === 401) {
      onUnauthorized();
      throw new Error('Your administrative session expired. Sign in again.');
    }
    if (!response.ok || !envelope.success)
      throw new Error(envelope.error?.message ?? 'Request failed.');
    return envelope.data as T;
  };
  const queue = useQuery({
    queryKey: ['admin-owner-verifications'],
    queryFn: () => api<OwnerSummary[]>('/admin/owners?status=PENDING_VERIFICATION'),
  });
  const detail = useQuery({
    queryKey: ['admin-owner-verification', selectedId],
    queryFn: () => api<OwnerDetail>(`/admin/owners/${selectedId}`),
    enabled: Boolean(selectedId),
  });
  const action = useMutation({
    mutationFn: ({ operation, reason }: { readonly operation: string; readonly reason?: string }) =>
      api(`/admin/owners/${selectedId}/${operation}`, {
        method: 'POST',
        ...(reason ? { body: JSON.stringify({ reason }) } : {}),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-owner-verifications'] });
      void client.invalidateQueries({ queryKey: ['admin-owner-verification', selectedId] });
    },
  });
  const requestAccess = async (fileId: string) => {
    const grant = await api<{ contentPath: string; expiresAt: string; mimeType: string }>(
      `/files/${fileId}/access-grants`,
      { method: 'POST' },
    );
    return {
      expiresAt: grant.expiresAt,
      mimeType: grant.mimeType,
      url: `${new URL(API_URL).origin}${grant.contentPath}`,
    };
  };
  const owner = detail.data;
  useEffect(() => {
    if (queue.error) console.error('Owner verification queue failed to load', queue.error);
    if (detail.error) console.error('Owner verification detail failed to load', detail.error);
  }, [detail.error, queue.error]);
  return (
    <section
      className={`admin-card module-section module-owner-verification ${selectedId ? 'is-detail-route' : ''}`}
    >
      <span className="eyebrow">Owner verification</span>
      <h2>Pending review</h2>
      <p>Review submitted owner identity evidence without exposing permanent private-file URLs.</p>
      {queue.isLoading && <div className="state-panel">Loading owner verification queue…</div>}
      {queue.isError && (
        <div className="state-panel error-state" role="alert">
          <strong>Owner verification queue could not be loaded.</strong>
          <p>Check the connection and try again.</p>
          <button className="quiet compact" onClick={() => void queue.refetch()}>
            Retry
          </button>
        </div>
      )}
      {queue.data?.length === 0 && (
        <EmptyState
          title="No owners awaiting verification"
          description="All submitted owner applications have been reviewed."
        />
      )}
      {queue.data && queue.data.length > 0 && (
        <DataTable label="Owner verification queue">
          <thead>
            <tr>
              <th>Owner</th>
              <th>Contact</th>
              <th>Submitted</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {queue.data.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>
                    {item.legalName ?? item.user.profile?.displayName ?? 'Unnamed owner'}
                  </strong>
                </td>
                <td>{item.user.email ?? 'No email'}</td>
                <td>{formatDate(item.submittedAt)}</td>
                <td>
                  <StatusBadge value={item.status} />
                </td>
                <td>
                  <Link
                    href={`/admin/verification/owners/${item.id}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    Review
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {selectedId && detail.isLoading && (
        <div className="state-panel">Loading owner verification…</div>
      )}
      {selectedId && detail.isError && (
        <div className="state-panel error-state" role="alert">
          <strong>Owner verification could not be loaded.</strong>
          <p>The case may have changed or the connection was interrupted.</p>
          <button className="quiet compact" onClick={() => void detail.refetch()}>
            Retry
          </button>
        </div>
      )}
      {selectedId && owner && (
        <div className="detail-page">
          <AdminDetailHeader
            backHref="/admin/verification/owners"
            backLabel="Owner queue"
            eyebrow="Owner verification workspace"
            title={
              owner.legalName ??
              owner.user.profile?.displayName ??
              owner.user.email ??
              'Unnamed owner'
            }
            status={owner.status}
            description={`Submitted ${formatDate(owner.submittedAt)}`}
          />
          <AdminSummaryGrid>
            <AdminSummaryCard
              label="Account"
              value={owner.user.email ?? 'No email'}
              detail={`Member since ${new Date(owner.user.createdAt).toLocaleDateString()}`}
            />
            <AdminSummaryCard
              label="Contact verification"
              value={
                owner.user.emailVerifiedAt && owner.user.mobileVerifiedAt
                  ? 'Verified'
                  : 'Needs review'
              }
            />
            <AdminSummaryCard label="Verification" value={adminLabel(owner.status)} />
            <AdminSummaryCard
              label="Evidence"
              value={String(owner.verifications.flatMap((item) => item.documents).length)}
            />
          </AdminSummaryGrid>
          <AdminSection title="Owner identity & account">
            <AdminDefinitionList
              items={[
                { label: 'Legal name', value: owner.legalName ?? 'Not provided' },
                { label: 'Email', value: owner.user.email ?? 'Not provided' },
                {
                  label: 'Mobile',
                  value: owner.contactNumber ?? owner.user.mobileNumber ?? 'Not provided',
                },
                {
                  label: 'Email verification',
                  value: owner.user.emailVerifiedAt ? 'Verified' : 'Not verified',
                },
                {
                  label: 'Mobile verification',
                  value: owner.user.mobileVerifiedAt ? 'Verified' : 'Not verified',
                },
                {
                  label: 'Address',
                  value:
                    [
                      owner.addressLine1,
                      owner.barangay,
                      owner.city,
                      owner.province,
                      owner.postalCode,
                    ]
                      .filter(Boolean)
                      .join(', ') || 'Not provided',
                },
              ]}
            />
          </AdminSection>
          <AdminSection
            title="Protected owner evidence"
            description="Previews and full-size views each require an explicit audited temporary access grant."
          >
            <div className="admin-evidence-grid">
              {owner.verifications.flatMap((verification) =>
                verification.documents.map((document) => (
                  <AdminEvidenceCard
                    key={document.id}
                    label={adminLabel(document.documentType)}
                    status={document.status}
                    note="Owner verification evidence"
                    requestAccess={() => requestAccess(document.fileAsset.id)}
                  />
                )),
              )}
            </div>
            {owner.verifications.flatMap((verification) => verification.documents).length === 0 && (
              <EmptyState
                title="No owner evidence"
                description="This owner case does not currently contain protected verification evidence."
              />
            )}
          </AdminSection>
          <AdminSection title="Review history">
            <AdminTimeline
              events={owner.verifications.map((verification) => ({
                id: verification.id,
                title: adminLabel(verification.status),
                occurredAt: verification.reviewedAt ?? verification.submittedAt,
                detail:
                  verification.rejectionReason ??
                  (verification.reviewedAt ? 'Review recorded' : 'Awaiting administrator review'),
              }))}
            />
          </AdminSection>
          <AdminActionBar description="Only existing audited owner-verification commands are available.">
            {owner.status === 'PENDING_VERIFICATION' && (
              <>
                <button
                  disabled={action.isPending}
                  onClick={() => action.mutate({ operation: 'approval' })}
                >
                  Approve owner
                </button>
                <button
                  className="danger"
                  disabled={action.isPending}
                  onClick={() => {
                    const reason = window.prompt('Rejection reason');
                    if (reason) action.mutate({ operation: 'rejection', reason });
                  }}
                >
                  Reject
                </button>
              </>
            )}
            {owner.status === 'VERIFIED' && (
              <button
                className="danger"
                disabled={action.isPending}
                onClick={() => {
                  const reason = window.prompt('Suspension reason');
                  if (reason) action.mutate({ operation: 'suspension', reason });
                }}
              >
                Suspend
              </button>
            )}
          </AdminActionBar>
          {action.isSuccess && <p className="success-text">Owner verification decision saved.</p>}
          {action.isError && <p className="error-text">{action.error.message}</p>}
        </div>
      )}
    </section>
  );
}
