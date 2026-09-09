'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import {
  AdminActionBar,
  AdminDefinitionList,
  AdminDetailHeader,
  AdminErrorDialog,
  AdminEvidenceCard,
  AdminSection,
  AdminSummaryCard,
  AdminSummaryGrid,
  AdminTechnicalDetails,
  AdminTimeline,
  DataTable,
  EmptyState,
  StatusBadge,
} from './AdminPrimitives';
import { adminLabel, formatDate } from './admin-presentation';
import { useAdminSession } from './AdminSession';

import { API_URL } from './admin-environment';
interface Envelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { readonly message: string };
}
interface QueueItem {
  readonly id: string;
  readonly status: string;
  readonly submittedAt: string | null;
  readonly userId: string;
  readonly user: {
    readonly email: string | null;
    readonly mobileNumber: string | null;
    readonly profile: {
      readonly displayName: string | null;
      readonly firstName: string | null;
      readonly lastName: string | null;
    } | null;
  };
}
interface VerificationDetail {
  readonly id: string;
  readonly status: string;
  readonly submittedAt: string | null;
  readonly reviewedAt: string | null;
  readonly reviewedBy: {
    readonly email: string | null;
    readonly profile: { readonly displayName: string | null } | null;
  } | null;
  readonly reviewedByAdmin: {
    readonly id: string;
    readonly displayName: string;
    readonly role: string;
  } | null;
  readonly addressAssessment: string | null;
  readonly addressReviewNotes: string | null;
  readonly addressAssessedAt: string | null;
  readonly addressAssessedBy: {
    readonly email: string | null;
    readonly profile: { readonly displayName: string | null } | null;
  } | null;
  readonly user: {
    readonly createdAt: string;
    readonly email: string | null;
    readonly emailVerifiedAt: string | null;
    readonly mobileNumber: string | null;
    readonly mobileVerifiedAt: string | null;
    readonly profile: {
      readonly addressLine1: string | null;
      readonly region: string | null;
      readonly barangay: string | null;
      readonly cityMunicipality: string | null;
      readonly dateOfBirth: string | null;
      readonly driverLicenseClass: string | null;
      readonly driverLicenseExpiry: string | null;
      readonly driverLicenseLastFour: string | null;
      readonly driverLicenseRestrictions: string | null;
      readonly emergencyContactMobile: string | null;
      readonly emergencyContactName: string | null;
      readonly emergencyContactRelation: string | null;
      readonly firstName: string | null;
      readonly lastName: string | null;
      readonly middleName: string | null;
      readonly postalCode: string | null;
      readonly province: string | null;
    } | null;
    readonly securityEvents: readonly {
      readonly id: string;
      readonly type: string;
      readonly occurredAt: string;
    }[];
    readonly verifications: readonly {
      readonly id: string;
      readonly type: string;
      readonly status: string;
      readonly rejectionReason: string | null;
      readonly reviewedAt: string | null;
      readonly documents: readonly {
        readonly id: string;
        readonly status: string;
        readonly definition: { readonly code: string; readonly name: string } | null;
        readonly fileAsset: {
          readonly id: string;
          readonly mimeType: string;
          readonly originalName: string;
        };
      }[];
    }[];
  };
}

export function RenterVerificationAdminPanel({
  accessToken,
  initialSelectedId,
  onUnauthorized,
}: {
  readonly accessToken: string;
  readonly initialSelectedId?: string;
  readonly onUnauthorized: () => void;
}) {
  const { can } = useAdminSession();
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(initialSelectedId ?? null);
  const [addressAssessment, setAddressAssessment] = useState<string>();
  const [addressNotes, setAddressNotes] = useState<string>();
  const [detailTab, setDetailTab] = useState<'overview' | 'documents' | 'audit'>('overview');
  const [decisionError, setDecisionError] = useState<string>();
  const api = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
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
    queryKey: ['admin-renter-verifications'],
    queryFn: () => api<QueueItem[]>('/admin/renter-verifications'),
  });
  const detail = useQuery({
    queryKey: ['admin-renter-verification', selected],
    queryFn: () => api<VerificationDetail>(`/admin/renter-verifications/${selected}`),
    enabled: Boolean(selected),
  });
  const action = useMutation({
    mutationFn: ({
      operation,
      reason,
      body,
    }: {
      operation: string;
      reason?: string;
      body?: object;
    }) =>
      api(`/admin/renter-verifications/${selected}/${operation}`, {
        method: 'POST',
        ...(body || reason ? { body: JSON.stringify(body ?? { reason }) } : {}),
      }),
    onSuccess: (_result, variables) => {
      if (variables.operation === 'review') {
        client.setQueryData<VerificationDetail>(
          ['admin-renter-verification', selected],
          (current) =>
            current
              ? { ...current, reviewedAt: new Date().toISOString(), status: 'UNDER_REVIEW' }
              : current,
        );
      }
      void client.invalidateQueries({ queryKey: ['admin-renter-verifications'] });
      void client.invalidateQueries({ queryKey: ['admin-renter-verification', selected] });
    },
  });
  const grantDocument = async (fileAssetId: string) => {
    const grant = await api<{ contentPath: string; expiresAt: string; mimeType: string }>(
      `/files/${fileAssetId}/access-grants`,
      { method: 'POST' },
    );
    return {
      expiresAt: grant.expiresAt,
      mimeType: grant.mimeType,
      url: `${new URL(API_URL).origin}${grant.contentPath}`,
    };
  };
  const renter = detail.data?.user;
  const profile = renter?.profile;
  const effectiveAddressAssessment = addressAssessment ?? detail.data?.addressAssessment ?? '';
  const effectiveAddressNotes = addressNotes ?? detail.data?.addressReviewNotes ?? '';
  return (
    <section className="admin-card vehicle-review-card">
      {!selected && (
        <>
          <span className="eyebrow">RENTER KYC</span>
          <h2>Renter verification queue</h2>
          <p>Only authorized verification staff can open sensitive renter evidence.</p>
          {queue.isLoading && <p>Loading verification queue…</p>}
          {queue.isError && <p className="error-text">{queue.error.message}</p>}
          {queue.data?.length === 0 && (
            <EmptyState
              title="No renter cases awaiting review"
              description="All submitted renter verification cases have been reviewed."
            />
          )}
          {queue.data && queue.data.length > 0 && (
            <DataTable label="Renter verification queue">
              <thead>
                <tr>
                  <th>Renter</th>
                  <th>Contact</th>
                  <th>Submitted</th>
                  <th>Waiting time</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {queue.data.map((item) => {
                  const submitted = item.submittedAt ? new Date(item.submittedAt) : null;
                  const waitingHours = submitted
                    ? Math.max(
                        0,
                        Math.floor((queue.dataUpdatedAt - submitted.getTime()) / 3_600_000),
                      )
                    : null;
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>
                          {item.user.profile?.displayName ||
                            [item.user.profile?.firstName, item.user.profile?.lastName]
                              .filter(Boolean)
                              .join(' ') ||
                            item.user.email ||
                            'Unnamed renter'}
                        </strong>
                      </td>
                      <td>
                        {item.user.email ?? 'No email'}
                        <small>{item.user.mobileNumber ?? 'No mobile'}</small>
                      </td>
                      <td>{submitted ? submitted.toLocaleString() : 'Not submitted'}</td>
                      <td>{waitingHours === null ? '—' : `${waitingHours}h`}</td>
                      <td>
                        <StatusBadge value={item.status} />
                      </td>
                      <td>
                        <Link
                          href={`/admin/verification/renters/${item.id}`}
                          onClick={() => {
                            setAddressAssessment(undefined);
                            setAddressNotes(undefined);
                            setSelected(item.id);
                          }}
                        >
                          Review
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </>
      )}
      {selected && detail.isLoading && <p>Loading secure case…</p>}
      {selected && detail.isError && (
        <p className="error-text">Case is unavailable or access is not permitted.</p>
      )}
      {selected && detail.data && renter && (
        <div className="detail-page">
          <AdminDetailHeader
            backHref="/admin/verification/renters"
            backLabel="Verification queue"
            eyebrow="Sensitive review workspace"
            title={
              [profile?.firstName, profile?.middleName, profile?.lastName]
                .filter(Boolean)
                .join(' ') ||
              renter.email ||
              'Unnamed renter'
            }
            status={detail.data.status}
            description={`${renter.email ?? 'No email'} · ${renter.mobileNumber ?? 'No mobile'} · Submitted ${formatDate(detail.data.submittedAt)} · Member since ${new Date(renter.createdAt).toLocaleDateString()}`}
          />

          <AdminSummaryGrid>
            <AdminSummaryCard label="Identity" value={adminLabel(detail.data.status)} />
            <AdminSummaryCard
              label="Contact"
              value={
                renter.emailVerifiedAt && renter.mobileVerifiedAt ? 'Verified' : 'Needs review'
              }
              detail={`${renter.emailVerifiedAt ? 'Email verified' : 'Email unverified'} · ${renter.mobileVerifiedAt ? 'Mobile verified' : 'Mobile unverified'}`}
            />
            <AdminSummaryCard
              label="Address assessment"
              value={adminLabel(detail.data.addressAssessment ?? 'PENDING_REVIEW')}
              detail={
                detail.data.addressAssessedAt
                  ? `Updated ${formatDate(detail.data.addressAssessedAt)}`
                  : 'Manual comparison required'
              }
            />
            <AdminSummaryCard
              label="Driver's license"
              value={
                profile?.driverLicenseLastFour
                  ? `Ending ${profile.driverLicenseLastFour}`
                  : 'Missing'
              }
              detail={
                profile?.driverLicenseExpiry
                  ? `Expires ${new Date(profile.driverLicenseExpiry).toLocaleDateString()}`
                  : undefined
              }
            />
            <AdminSummaryCard
              label="Documents"
              value={String(renter.verifications.flatMap((item) => item.documents).length)}
              detail="Protected evidence files"
            />
          </AdminSummaryGrid>

          <div className="detail-tabs" role="tablist" aria-label="Verification workspace sections">
            {(['overview', 'documents', 'audit'] as const).map((tab) => (
              <button
                aria-selected={detailTab === tab}
                className={detailTab === tab ? 'active' : ''}
                key={tab}
                onClick={() => setDetailTab(tab)}
                role="tab"
              >
                {tab === 'audit' ? 'Security & audit' : adminLabel(tab)}
              </button>
            ))}
          </div>

          {detailTab === 'overview' && (
            <>
              <AdminSection
                title="Account overview"
                description="Identity and contact information supplied by the renter."
              >
                <AdminDefinitionList
                  items={[
                    { label: 'Email', value: renter.email ?? 'Not provided' },
                    {
                      label: 'Email verification',
                      value: renter.emailVerifiedAt ? 'Verified' : 'Not verified',
                    },
                    { label: 'Mobile', value: renter.mobileNumber ?? 'Not provided' },
                    {
                      label: 'Mobile verification',
                      value: renter.mobileVerifiedAt ? 'Verified' : 'Not verified',
                    },
                    {
                      label: 'Member since',
                      value: new Date(renter.createdAt).toLocaleDateString(),
                    },
                    {
                      label: 'Date of birth',
                      value: profile?.dateOfBirth
                        ? new Date(profile.dateOfBirth).toLocaleDateString()
                        : 'Not provided',
                    },
                  ]}
                />
              </AdminSection>

              <AdminSection
                title="Identity & address"
                description="Structured legal identity and renter-entered residential address. Protected evidence is available only in the Documents tab."
              >
                <div className="identity-address-grid">
                  <div className="address-review-panel">
                    <h4>Personal and legal identity</h4>
                    <AdminDefinitionList
                      items={[
                        { label: 'First name', value: profile?.firstName ?? 'Not provided' },
                        { label: 'Middle name', value: profile?.middleName ?? 'Not provided' },
                        { label: 'Last name', value: profile?.lastName ?? 'Not provided' },
                        {
                          label: 'Date of birth',
                          value: profile?.dateOfBirth
                            ? new Date(profile.dateOfBirth).toLocaleDateString()
                            : 'Not provided',
                        },
                      ]}
                    />
                  </div>
                  <div className="address-review-panel profile-address-panel">
                    <h4>Renter-entered address</h4>
                    <AdminDefinitionList
                      items={[
                        { label: 'House / street', value: profile?.addressLine1 ?? 'Not provided' },
                        { label: 'Barangay', value: profile?.barangay ?? 'Not provided' },
                        {
                          label: 'City / municipality',
                          value: profile?.cityMunicipality ?? 'Not provided',
                        },
                        { label: 'Province', value: profile?.province ?? 'Not provided' },
                        { label: 'Region', value: profile?.region ?? 'Not provided' },
                        { label: 'Postal code', value: profile?.postalCode ?? 'Not provided' },
                      ]}
                    />
                  </div>
                </div>
                <div className="address-assessment-form">
                  <fieldset>
                    <legend>Address verification assessment</legend>
                    <p>
                      Compare the renter’s submitted address with the verified documentation before
                      making a decision. Evidence is available in the Documents tab.
                    </p>
                    {(
                      [
                        ['MATCH', '✓', 'Match', 'The important address details agree.'],
                        [
                          'POSSIBLE_MATCH',
                          '~',
                          'Minor discrepancy',
                          'There is a small explainable difference.',
                        ],
                        ['MISMATCH', '!', 'Mismatch', 'Material address details do not agree.'],
                        [
                          'NOT_APPLICABLE',
                          '?',
                          'Unable to verify',
                          'The available evidence is insufficient to compare.',
                        ],
                      ] as const
                    ).map(([value, icon, label, description]) => (
                      <label
                        className={`assessment-option assessment-${value.toLowerCase().replaceAll('_', '-')} ${effectiveAddressAssessment === value ? 'is-selected' : ''}`}
                        key={value}
                      >
                        <input
                          checked={effectiveAddressAssessment === value}
                          name="address-assessment"
                          onChange={() => setAddressAssessment(value)}
                          type="radio"
                          value={value}
                        />
                        <span className="assessment-icon" aria-hidden>
                          {icon}
                        </span>
                        <span>
                          <strong>{label}</strong>
                          <small>{description}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <label className="reviewer-notes">
                    <span>Reviewer notes *</span>
                    <textarea
                      onChange={(event) => setAddressNotes(event.target.value)}
                      placeholder="Record relevant differences or reasons for concern."
                      value={effectiveAddressNotes}
                    />
                    <small>
                      Required before approving the renter. Explain the checks completed and record
                      only information relevant to the verification decision.
                    </small>
                  </label>
                  <button
                    disabled={
                      !effectiveAddressAssessment ||
                      action.isPending ||
                      (['POSSIBLE_MATCH', 'MISMATCH'].includes(effectiveAddressAssessment) &&
                        effectiveAddressNotes.trim().length === 0)
                    }
                    onClick={() =>
                      action.mutate({
                        operation: 'address-assessment',
                        body: {
                          assessment: effectiveAddressAssessment,
                          ...(effectiveAddressNotes ? { notes: effectiveAddressNotes } : {}),
                        },
                      })
                    }
                  >
                    {action.isPending && action.variables?.operation === 'address-assessment'
                      ? 'Saving assessment…'
                      : 'Save address assessment'}
                  </button>
                  {!effectiveAddressNotes.trim() && (
                    <p className="field-help error-text">
                      Reviewer notes must be saved before this case can be approved.
                    </p>
                  )}
                  {['POSSIBLE_MATCH', 'MISMATCH'].includes(effectiveAddressAssessment) &&
                    !effectiveAddressNotes.trim() && (
                      <p className="field-help error-text">
                        Reviewer notes are required for this assessment.
                      </p>
                    )}
                  {action.isSuccess && action.variables?.operation === 'address-assessment' && (
                    <p className="success-text" role="status">
                      Address assessment saved.
                    </p>
                  )}
                  {detail.data.addressAssessedAt && (
                    <div className="assessment-saved-state" role="status">
                      <strong>Saved</strong>
                      <span>
                        {detail.data.addressAssessedBy?.profile?.displayName ??
                          detail.data.addressAssessedBy?.email ??
                          'Administrator'}{' '}
                        · {formatDate(detail.data.addressAssessedAt)}
                      </span>
                      <StatusBadge value={detail.data.addressAssessment} />
                      {detail.data.addressReviewNotes && <p>{detail.data.addressReviewNotes}</p>}
                    </div>
                  )}
                  <p>
                    Text formatting and renamed geographic areas never trigger automatic rejection;
                    the reviewer decision remains authoritative.
                  </p>
                </div>
              </AdminSection>

              <AdminSection title="Driver information">
                <AdminDefinitionList
                  items={[
                    {
                      label: 'License number',
                      value: profile?.driverLicenseLastFour
                        ? `Ending ${profile.driverLicenseLastFour}`
                        : 'Not provided',
                    },
                    {
                      label: 'Expiration',
                      value: profile?.driverLicenseExpiry
                        ? new Date(profile.driverLicenseExpiry).toLocaleDateString()
                        : 'Not provided',
                    },
                    { label: 'Class', value: profile?.driverLicenseClass ?? 'Not provided' },
                    {
                      label: 'Restrictions',
                      value: profile?.driverLicenseRestrictions ?? 'None recorded',
                    },
                    {
                      label: 'Verification status',
                      value: <StatusBadge value={detail.data.status} />,
                    },
                  ]}
                />
              </AdminSection>
            </>
          )}

          {detailTab === 'documents' && (
            <AdminSection
              title="Protected evidence"
              description="Every open action creates the existing five-minute audited access grant."
            >
              <div className="admin-evidence-grid">
                {renter.verifications.flatMap((verification) =>
                  verification.documents.map((document) => (
                    <AdminEvidenceCard
                      key={document.id}
                      displayMode={
                        ['SELFIE', 'LIVENESS', 'SELFIE_LIVENESS'].some((value) =>
                          (document.definition?.code ?? '').includes(value),
                        )
                          ? 'photo'
                          : 'document'
                      }
                      label={document.definition?.name ?? 'Identity evidence'}
                      status={document.status}
                      note={`${adminLabel(verification.type)} · temporary access`}
                      requestAccess={() => grantDocument(document.fileAsset.id)}
                    />
                  )),
                )}
              </div>
              {renter.verifications.flatMap((verification) => verification.documents).length ===
                0 && (
                <EmptyState
                  title="No evidence uploaded"
                  description="This verification currently has no protected evidence files."
                />
              )}
            </AdminSection>
          )}

          {detailTab === 'audit' && (
            <>
              <AdminSection
                title="Verification decisions"
                description="Previous review outcomes remain authoritative and auditable."
              >
                <AdminTimeline
                  events={renter.verifications.map((verification) => ({
                    id: verification.id,
                    title: `${adminLabel(verification.type)} ${adminLabel(verification.status).toLowerCase()}`,
                    occurredAt: verification.reviewedAt,
                    detail:
                      verification.rejectionReason ??
                      (verification.reviewedAt ? 'Review recorded' : 'Awaiting review'),
                  }))}
                />
              </AdminSection>
              <AdminTechnicalDetails
                summary={`View security history (${renter.securityEvents.length})`}
              >
                <DataTable label="Recent renter security history">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Date/time</th>
                      <th>Result</th>
                      <th>Metadata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renter.securityEvents.map((event) => (
                      <tr key={event.id}>
                        <td>{adminLabel(event.type)}</td>
                        <td>{formatDate(event.occurredAt)}</td>
                        <td>Recorded</td>
                        <td>
                          <small>{event.id}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </AdminTechnicalDetails>
            </>
          )}

          {can('renters.verifications.review') && (
            <AdminActionBar
              title={
                detail.data.status === 'SUBMITTED'
                  ? 'Begin case review'
                  : 'Final verification decision'
              }
              description={
                detail.data.status === 'SUBMITTED'
                  ? 'Marks this case as being actively reviewed. This does not approve the renter.'
                  : detail.data.status === 'UNDER_REVIEW'
                    ? `Review started ${formatDate(detail.data.reviewedAt)} by ${detail.data.reviewedByAdmin?.displayName ?? detail.data.reviewedBy?.profile?.displayName ?? detail.data.reviewedBy?.email ?? 'an administrator'}.`
                    : 'Actions use the existing authorized verification commands and audit trail.'
              }
            >
              {detail.data.status === 'SUBMITTED' && (
                <button onClick={() => action.mutate({ operation: 'review' })}>
                  Start verification review
                </button>
              )}
              {detail.data.status === 'UNDER_REVIEW' && (
                <div className="verification-decision-actions">
                  <div>
                    <button
                      disabled={action.isPending}
                      onClick={() => {
                        if (!detail.data.addressAssessment) {
                          setDecisionError(
                            'Complete and save the address verification assessment before approving this renter.',
                          );
                          return;
                        }
                        if (!detail.data.addressReviewNotes?.trim()) {
                          setDecisionError(
                            'Add and save reviewer notes documenting the checks completed before approving this renter.',
                          );
                          return;
                        }
                        action.mutate({ operation: 'approval' });
                      }}
                    >
                      Approve renter
                    </button>
                    <small>
                      All required identity and driving checks have passed. A saved assessment and
                      reviewer notes are required.
                    </small>
                  </div>
                  <div>
                    <button
                      className="warning"
                      onClick={() => {
                        const reason = window.prompt(
                          'What information must the renter replace or correct?',
                        );
                        if (reason) action.mutate({ operation: 'more-information', reason });
                      }}
                    >
                      Request more information
                    </button>
                    <small>
                      Ask the renter to correct or provide additional verification information.
                    </small>
                  </div>
                  <div>
                    <button
                      className="danger"
                      onClick={() => {
                        const reason = window.prompt('Rejection reason');
                        if (reason) action.mutate({ operation: 'rejection', reason });
                      }}
                    >
                      Reject verification
                    </button>
                    <small>Reject this verification request with a documented reason.</small>
                  </div>
                </div>
              )}
              {detail.data.status === 'APPROVED' && (
                <button
                  className="danger"
                  onClick={() => {
                    const reason = window.prompt('Suspension reason');
                    if (reason) action.mutate({ operation: 'suspension', reason });
                  }}
                >
                  Suspend
                </button>
              )}
            </AdminActionBar>
          )}
          {(decisionError || action.isError) && (
            <AdminErrorDialog
              message={
                decisionError ?? action.error?.message ?? 'The request could not be completed.'
              }
              onClose={() => {
                setDecisionError(undefined);
                action.reset();
              }}
              title={
                action.variables?.operation === 'address-assessment'
                  ? 'Assessment could not be saved'
                  : 'Verification action could not be completed'
              }
            />
          )}
        </div>
      )}
    </section>
  );
}
