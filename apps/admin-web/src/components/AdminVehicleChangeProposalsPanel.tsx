'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  AdminActionBar,
  AdminDefinitionList,
  AdminDetailHeader,
  AdminEvidenceCard,
  AdminSection,
  AdminSummaryCard,
  AdminSummaryGrid,
  DataTable,
  EmptyState,
  StatusBadge,
} from './AdminPrimitives';
import { adminLabel, formatDate } from './admin-presentation';

type Snapshot = {
  vehicle: Record<string, string | number | null>;
  featureIds: readonly string[];
  photos: readonly { fileAssetId: string }[];
  documents: readonly { fileAssetId: string }[];
  location: { city: string; province: string } | null;
  policy: Record<string, string | number | boolean | null>;
};
type ProposalItem = {
  id: string;
  vehicleId: string;
  vehicle: { displayName: string };
  workspace: { id: string; name: string };
  submitter: { displayName: string };
  changedFields: readonly string[];
  status: string;
  submittedAt: string | null;
  stale: boolean;
};
type ProposalDetail = ProposalItem & {
  baseVehicleRevision: number;
  currentVehicleRevision: number;
  currentSnapshot: Snapshot;
  proposedSnapshot: Snapshot;
  ownerApprovalRequired: boolean;
  ownerApprovalBypassed: boolean;
  trustEnabledAtSubmission: boolean;
  platformReviewReason: string | null;
  assets: readonly { fileAssetId: string; kind: 'PHOTO' | 'DOCUMENT'; originalName: string }[];
  reviewHistory: readonly { action: string; reason: string | null; occurredAt: string }[];
};

export function AdminVehicleChangeProposalsPanel({
  initialSelectedId,
  request,
  requestFileAccess,
}: {
  readonly initialSelectedId?: string;
  readonly request: <T>(path: string, init?: RequestInit) => Promise<T>;
  readonly requestFileAccess: (
    id: string,
  ) => Promise<{ url: string; mimeType: string; expiresAt: string }>;
}) {
  const client = useQueryClient();
  const queue = useQuery({
    queryKey: ['admin-vehicle-change-proposals'],
    queryFn: () => request<{ proposals: ProposalItem[] }>('/admin/vehicle-change-proposals'),
  });
  const detail = useQuery({
    queryKey: ['admin-vehicle-change-proposal', initialSelectedId],
    queryFn: () => request<ProposalDetail>(`/admin/vehicle-change-proposals/${initialSelectedId}`),
    enabled: Boolean(initialSelectedId),
  });
  const decision = useMutation({
    mutationFn: ({ operation, reason }: { operation: string; reason?: string }) =>
      request(`/admin/vehicle-change-proposals/${initialSelectedId}/${operation}`, {
        ...(reason ? { body: JSON.stringify({ reason }) } : {}),
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-vehicle-change-proposals'] });
      void client.invalidateQueries({
        queryKey: ['admin-vehicle-change-proposal', initialSelectedId],
      });
    },
  });

  if (initialSelectedId) {
    if (detail.isLoading) return <p>Loading vehicle-change proposal…</p>;
    if (!detail.data) return <p className="error-text">Unable to load this proposal.</p>;
    const proposal = detail.data;
    const comparisonRows = proposal.changedFields.map((field) => {
      const key = field.startsWith('vehicle.')
        ? field.slice('vehicle.'.length)
        : field.startsWith('policy.')
          ? field.slice('policy.'.length)
          : field;
      const current = field.startsWith('vehicle.')
        ? proposal.currentSnapshot.vehicle[key]
        : field.startsWith('policy.')
          ? proposal.currentSnapshot.policy[key]
          : summarize(proposal.currentSnapshot, field);
      const proposed = field.startsWith('vehicle.')
        ? proposal.proposedSnapshot.vehicle[key]
        : field.startsWith('policy.')
          ? proposal.proposedSnapshot.policy[key]
          : summarize(proposal.proposedSnapshot, field);
      return {
        label: adminLabel(field.replaceAll('.', ' ')),
        value: (
          <span>
            <strong>Current:</strong> {display(current)}
            <br />
            <strong>Proposed:</strong> {display(proposed)}
          </span>
        ),
      };
    });
    return (
      <div className="detail-page">
        <AdminDetailHeader
          backHref="/admin/vehicles"
          backLabel="Vehicle changes"
          eyebrow="Vehicle change review"
          title={proposal.vehicle.displayName}
          status={proposal.status}
          description={`${proposal.workspace.name} · Submitted by ${proposal.submitter.displayName}`}
        />
        {proposal.stale && (
          <p className="error-text">
            Live vehicle changed after this proposal was submitted. Approval is unavailable.
          </p>
        )}
        <AdminSummaryGrid>
          <AdminSummaryCard
            label="Current live revision"
            value={String(proposal.currentVehicleRevision)}
          />
          <AdminSummaryCard
            label="Proposal base revision"
            value={String(proposal.baseVehicleRevision)}
          />
          <AdminSummaryCard
            label="Owner decision"
            value={
              proposal.ownerApprovalBypassed
                ? 'Trusted bypass'
                : proposal.ownerApprovalRequired
                  ? 'Approved by Owner'
                  : 'Not required'
            }
          />
          <AdminSummaryCard label="Submitted" value={formatDate(proposal.submittedAt)} />
        </AdminSummaryGrid>
        <AdminSection
          title="Current live vs proposed"
          description="Only the proposal is under review. The approved live vehicle remains active until promotion succeeds."
        >
          <AdminDefinitionList items={comparisonRows} />
        </AdminSection>
        <AdminSection
          title="Proposal assets"
          description="Private proposal-owned evidence. Viewing does not publish these files."
        >
          <div className="evidence-grid">
            {proposal.assets.map((asset) => (
              <AdminEvidenceCard
                key={asset.fileAssetId}
                label={asset.originalName}
                displayMode={asset.kind === 'PHOTO' ? 'photo' : 'document'}
                status="Private proposal asset"
                requestAccess={() => requestFileAccess(asset.fileAssetId)}
              />
            ))}
          </div>
        </AdminSection>
        <AdminSection
          title="Current live photos"
          description="The photo set currently used by the approved live vehicle."
        >
          <div className="evidence-grid">
            {proposal.currentSnapshot.photos.map((photo, index) => (
              <AdminEvidenceCard
                key={photo.fileAssetId}
                label={`Current photo ${index + 1}`}
                displayMode="photo"
                requestAccess={() => requestFileAccess(photo.fileAssetId)}
              />
            ))}
          </div>
        </AdminSection>
        <AdminSection
          title="Proposed photos and documents"
          description="The complete private media and document set that will be promoted only after approval."
        >
          <div className="evidence-grid">
            {proposal.proposedSnapshot.photos.map((photo, index) => (
              <AdminEvidenceCard
                key={photo.fileAssetId}
                label={`Proposed photo ${index + 1}`}
                displayMode="photo"
                requestAccess={() => requestFileAccess(photo.fileAssetId)}
              />
            ))}
            {proposal.proposedSnapshot.documents.map((document, index) => (
              <AdminEvidenceCard
                key={document.fileAssetId}
                label={`Proposed document ${index + 1}`}
                displayMode="document"
                status="Verification pending"
                requestAccess={() => requestFileAccess(document.fileAssetId)}
              />
            ))}
          </div>
        </AdminSection>
        <AdminSection title="Review history" description="Audited proposal lifecycle decisions.">
          <DataTable label="Vehicle change proposal review history">
            <thead>
              <tr>
                <th>Action</th>
                <th>When</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {proposal.reviewHistory.map((entry) => (
                <tr key={`${entry.action}:${entry.occurredAt}`}>
                  <td>{adminLabel(entry.action)}</td>
                  <td>{formatDate(entry.occurredAt)}</td>
                  <td>{entry.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </AdminSection>
        <AdminActionBar description="Decisions target this proposal. The live vehicle stays approved unless atomic promotion succeeds.">
          {proposal.status === 'PENDING_PLATFORM_REVIEW' && (
            <>
              <button
                disabled={proposal.stale || decision.isPending}
                onClick={() => decision.mutate({ operation: 'approval' })}
              >
                Approve changes
              </button>
              <button
                className="warning"
                disabled={decision.isPending}
                onClick={() => {
                  const reason = window.prompt('Required changes');
                  if (reason) decision.mutate({ operation: 'change-request', reason });
                }}
              >
                Request changes
              </button>
              <button
                className="danger"
                disabled={decision.isPending}
                onClick={() => {
                  const reason = window.prompt('Rejection reason');
                  if (reason) decision.mutate({ operation: 'rejection', reason });
                }}
              >
                Reject
              </button>
            </>
          )}
        </AdminActionBar>
        {decision.error && <p className="error-text">{decision.error.message}</p>}
      </div>
    );
  }

  return (
    <AdminSection
      title="Vehicle changes awaiting review"
      description="Proposed revisions to existing approved vehicles. This queue is separate from new listing review."
    >
      {queue.isLoading && <p>Loading proposal queue…</p>}
      {queue.data?.proposals.length === 0 && (
        <EmptyState
          title="No vehicle changes awaiting review"
          description="All submitted vehicle-change proposals have been reviewed."
        />
      )}
      {queue.data?.proposals.length ? (
        <DataTable label="Vehicle change proposal queue">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Owner/workspace</th>
              <th>Submitted by</th>
              <th>Changes</th>
              <th>Submitted</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {queue.data.proposals.map((proposal) => (
              <tr key={proposal.id}>
                <td>
                  <strong>{proposal.vehicle.displayName}</strong>
                </td>
                <td>{proposal.workspace.name}</td>
                <td>{proposal.submitter.displayName}</td>
                <td>
                  {proposal.changedFields
                    .map((field) => adminLabel(field.replaceAll('.', ' ')))
                    .join(', ')}
                </td>
                <td>{formatDate(proposal.submittedAt)}</td>
                <td>
                  <StatusBadge value={proposal.status} />
                </td>
                <td>
                  <Link href={`/admin/vehicles/changes/${proposal.id}`}>Review changes</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : null}
    </AdminSection>
  );
}

function summarize(snapshot: Snapshot, field: string) {
  if (field === 'features') return `${snapshot.featureIds.length} selected`;
  if (field === 'photos') return `${snapshot.photos.length} photos`;
  if (field.startsWith('documents')) return `${snapshot.documents.length} documents`;
  if (field === 'location')
    return snapshot.location
      ? `${snapshot.location.city}, ${snapshot.location.province}`
      : 'Not configured';
  return 'Changed';
}

function display(value: unknown) {
  if (value === null || value === undefined || value === '') return 'Not configured';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
