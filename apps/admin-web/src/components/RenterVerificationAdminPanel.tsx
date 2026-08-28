'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
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
  readonly addressAssessment: string | null;
  readonly addressReviewNotes: string | null;
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

export function RenterVerificationAdminPanel({ accessToken }: { readonly accessToken: string }) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [addressAssessment, setAddressAssessment] = useState<string>();
  const [addressNotes, setAddressNotes] = useState<string>();
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
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin-renter-verifications'] });
      void client.invalidateQueries({ queryKey: ['admin-renter-verification', selected] });
    },
  });
  const openDocument = async (fileAssetId: string) => {
    const grant = await api<{ contentPath: string }>(`/files/${fileAssetId}/access-grants`, {
      method: 'POST',
    });
    window.open(`${new URL(API_URL).origin}${grant.contentPath}`, '_blank', 'noopener,noreferrer');
  };
  const renter = detail.data?.user;
  const profile = renter?.profile;
  const effectiveAddressAssessment = addressAssessment ?? detail.data?.addressAssessment ?? '';
  const effectiveAddressNotes = addressNotes ?? detail.data?.addressReviewNotes ?? '';
  return (
    <section className="admin-card vehicle-review-card">
      <span className="eyebrow">RENTER KYC</span>
      <h2>Renter verification queue</h2>
      <p>Only authorized verification staff can open sensitive renter evidence.</p>
      {queue.isLoading && <p>Loading verification queue…</p>}
      {queue.isError && <p className="error-text">{queue.error.message}</p>}
      {queue.data?.length === 0 && <p>No renter verification cases currently need review.</p>}
      {queue.data?.map((item) => (
        <button
          className="review-row review-button"
          key={item.id}
          onClick={() => {
            setAddressAssessment(undefined);
            setAddressNotes(undefined);
            setSelected(item.id);
          }}
        >
          <span>
            <strong>
              {item.user.profile?.displayName ??
                [item.user.profile?.firstName, item.user.profile?.lastName]
                  .filter(Boolean)
                  .join(' ') ??
                item.user.email}
            </strong>
            <span>
              {item.status} · {item.user.email} · {item.user.mobileNumber}
            </span>
          </span>
          <span>Review →</span>
        </button>
      ))}
      {selected && detail.isLoading && <p>Loading secure case…</p>}
      {selected && detail.isError && (
        <p className="error-text">Case is unavailable or access is not permitted.</p>
      )}
      {selected && detail.data && renter && (
        <div className="vehicle-detail">
          <div className="detail-heading">
            <div>
              <span className="eyebrow">SENSITIVE REVIEW WORKSPACE</span>
              <h3>
                {profile?.firstName} {profile?.middleName} {profile?.lastName}
              </h3>
              <p>
                {detail.data.status} · submitted{' '}
                {detail.data.submittedAt
                  ? new Date(detail.data.submittedAt).toLocaleString()
                  : 'not yet'}
              </p>
            </div>
            <button className="quiet" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <h4>Contact and account</h4>
          <p>
            Email: {renter.email} · {renter.emailVerifiedAt ? 'verified' : 'not verified'}
            <br />
            Mobile: {renter.mobileNumber} · {renter.mobileVerifiedAt ? 'verified' : 'not verified'}
            <br />
            Member since {new Date(renter.createdAt).toLocaleDateString()}
          </p>
          <h4>Identity and address review</h4>
          <p>
            Date of birth:{' '}
            {profile?.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString() : 'missing'}
          </p>
          <div className="address-review-grid">
            <div className="address-review-panel">
              <span className="eyebrow">RENTER ENTERED ADDRESS</span>
              <strong>{profile?.addressLine1 ?? 'Missing address line'}</strong>
              <span>{profile?.barangay ?? 'Missing barangay'}</span>
              <span>{profile?.cityMunicipality ?? 'Missing city / municipality'}</span>
              <span>
                {profile?.province ?? 'No province'} · {profile?.region ?? 'Missing region'}
              </span>
              <span>Postal code {profile?.postalCode ?? 'missing'}</span>
            </div>
            <div className="address-review-panel sensitive-panel">
              <span className="eyebrow">DOCUMENT ADDRESS</span>
              <p>Open the sensitive proof of address or identity document and compare manually.</p>
              {renter.verifications.flatMap((verification) =>
                verification.documents
                  .filter((document) =>
                    [
                      'PROOF_OF_ADDRESS',
                      'ADDITIONAL_GOVERNMENT_ID',
                      'DRIVER_LICENSE_FRONT',
                    ].includes(document.definition?.code ?? ''),
                  )
                  .map((document) => (
                    <button
                      className="file-button sensitive"
                      key={`address-${document.id}`}
                      onClick={() => void openDocument(document.fileAsset.id)}
                    >
                      Open {document.definition?.name ?? document.fileAsset.originalName}
                      <small>5-minute audited access grant</small>
                    </button>
                  )),
              )}
            </div>
          </div>
          <div className="address-assessment-form">
            <label>
              Reviewer assessment
              <select
                onChange={(event) => setAddressAssessment(event.target.value)}
                value={effectiveAddressAssessment}
              >
                <option value="">Select assessment</option>
                <option value="MATCH">Match</option>
                <option value="POSSIBLE_MATCH">Possible match / needs review</option>
                <option value="MISMATCH">Mismatch</option>
                <option value="NOT_APPLICABLE">Not applicable</option>
              </select>
            </label>
            <label>
              Reviewer notes
              <textarea
                onChange={(event) => setAddressNotes(event.target.value)}
                placeholder="Record abbreviations, old/new geographic names, or reasons for concern."
                value={effectiveAddressNotes}
              />
            </label>
            <button
              disabled={!effectiveAddressAssessment}
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
              Save address assessment
            </button>
            <p>
              Text differences, abbreviations, punctuation, and renamed PSGC areas do not trigger
              automatic rejection. The reviewer decision remains authoritative.
            </p>
          </div>
          <h4>Driver information</h4>
          <p>
            License ending {profile?.driverLicenseLastFour ?? 'missing'} · expires{' '}
            {profile?.driverLicenseExpiry
              ? new Date(profile.driverLicenseExpiry).toLocaleDateString()
              : 'missing'}
            <br />
            Class: {profile?.driverLicenseClass ?? 'missing'} · restrictions:{' '}
            {profile?.driverLicenseRestrictions ?? 'none recorded'}
          </p>
          <h4>Document checklist</h4>
          <div className="file-grid">
            {renter.verifications.flatMap((verification) =>
              verification.documents.map((document) => (
                <button
                  className="file-button sensitive"
                  key={document.id}
                  onClick={() => void openDocument(document.fileAsset.id)}
                >
                  {document.definition?.name ?? document.fileAsset.originalName}
                  <small>
                    {verification.type} · {document.status} · 5-minute audited grant
                  </small>
                </button>
              )),
            )}
          </div>
          <h4>Previous decisions</h4>
          <ol className="history">
            {renter.verifications.map((verification) => (
              <li key={verification.id}>
                <strong>
                  {verification.type} · {verification.status}
                </strong>
                <span>
                  {verification.reviewedAt
                    ? new Date(verification.reviewedAt).toLocaleString()
                    : 'Not reviewed'}
                  {verification.rejectionReason ? ` · ${verification.rejectionReason}` : ''}
                </span>
              </li>
            ))}
          </ol>
          <h4>Recent security history</h4>
          <ol className="history">
            {renter.securityEvents.map((event) => (
              <li key={event.id}>
                <strong>{event.type}</strong>
                <span>{new Date(event.occurredAt).toLocaleString()}</span>
              </li>
            ))}
          </ol>
          <div className="actions">
            {detail.data.status === 'SUBMITTED' && (
              <button onClick={() => action.mutate({ operation: 'review' })}>Start review</button>
            )}
            {['SUBMITTED', 'UNDER_REVIEW'].includes(detail.data.status) && (
              <>
                <button
                  disabled={!detail.data.addressAssessment}
                  onClick={() => action.mutate({ operation: 'approval' })}
                >
                  Approve
                </button>
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
                <button
                  className="danger"
                  onClick={() => {
                    const reason = window.prompt('Rejection reason');
                    if (reason) action.mutate({ operation: 'rejection', reason });
                  }}
                >
                  Reject
                </button>
              </>
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
          </div>
          {action.isError && <p className="error-text">{action.error.message}</p>}
        </div>
      )}
    </section>
  );
}
