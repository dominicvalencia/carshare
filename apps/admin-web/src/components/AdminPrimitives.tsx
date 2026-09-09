'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { adminLabel, formatDate } from './admin-presentation';

export function StatusBadge({
  value,
  label: labelOverride,
}: {
  readonly value?: string | null | undefined;
  readonly label?: string;
}) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const label = labelOverride ?? (normalized ? adminLabel(normalized) : 'Not available');
  const classValue = normalized
    ? normalized.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')
    : 'unknown';
  return (
    <span
      className={`status-badge status-${classValue} status-tone-${statusTone(normalized)}`}
      title={label}
    >
      {label}
    </span>
  );
}

export function statusTone(value: string): 'neutral' | 'info' | 'warning' | 'success' | 'danger' {
  if (
    ['REJECTED', 'SUSPENDED', 'CANCELLED', 'CANCELED', 'FAILED', 'DISPUTED', 'DISABLED'].includes(
      value,
    )
  )
    return 'danger';
  if (
    [
      'APPROVED',
      'VERIFIED',
      'ACTIVE',
      'COMPLETED',
      'RETURNED',
      'AVAILABLE',
      'PAID',
      'ELIGIBLE',
    ].includes(value)
  )
    return 'success';
  if (['CONFIRMED', 'READY_FOR_PICKUP'].includes(value)) return 'info';
  if (
    [
      'PENDING',
      'PENDING_REVIEW',
      'PENDING_APPROVAL',
      'PENDING_VERIFICATION',
      'SUBMITTED',
      'AWAITING_PAYMENT',
      'AWAITING_OWNER',
      'RETURN_PENDING',
      'MORE_INFORMATION_REQUIRED',
      'UNDER_REVIEW',
      'UNDER_ADMIN_REVIEW',
    ].includes(value)
  )
    return 'warning';
  return 'neutral';
}

export function AdminDetailHeader({
  backHref,
  backLabel,
  eyebrow,
  title,
  status,
  description,
  children,
}: {
  readonly backHref: string;
  readonly backLabel: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly status?: string;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <header className="admin-detail-header">
      <Link className="back-link" href={backHref}>
        ← {backLabel}
      </Link>
      <div className="admin-detail-title-row">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {status && <StatusBadge value={status} />}
      </div>
      {children}
    </header>
  );
}

export function AdminSection({
  title,
  description,
  children,
  className = '',
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={`admin-detail-section ${className}`}>
      <div className="admin-section-heading">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function AdminSummaryGrid({ children }: { readonly children: ReactNode }) {
  return <div className="admin-summary-grid">{children}</div>;
}

export function AdminSummaryCard({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
}) {
  return (
    <div className="admin-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export function AdminDefinitionList({
  items,
}: {
  readonly items: readonly { readonly label: string; readonly value: ReactNode }[];
}) {
  return (
    <dl className="admin-definition-list">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AdminTimeline({
  events,
}: {
  readonly events: readonly {
    readonly id: string;
    readonly title: string;
    readonly occurredAt?: string | null;
    readonly detail?: ReactNode;
    readonly status?: string;
  }[];
}) {
  return (
    <ol className="admin-timeline">
      {events.map((event) => (
        <li key={event.id}>
          <span className="timeline-marker" aria-hidden />
          <div>
            <div className="timeline-title">
              <strong>{event.title}</strong>
              {event.status && <StatusBadge value={event.status} />}
            </div>
            {event.occurredAt && <time>{formatDate(event.occurredAt)}</time>}
            {event.detail && <p>{event.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function AdminEvidenceCard({
  label,
  status,
  note,
  displayMode = 'document',
  requestAccess,
}: {
  readonly label: string;
  readonly status?: string;
  readonly note?: ReactNode;
  readonly displayMode?: 'document' | 'photo';
  readonly requestAccess: () => Promise<{
    readonly url: string;
    readonly mimeType: string;
    readonly expiresAt: string;
  }>;
}) {
  const [preview, setPreview] = useState<string>();
  const [previewExpiry, setPreviewExpiry] = useState<string>();
  const [previewState, setPreviewState] = useState<
    'idle' | 'granting' | 'loading' | 'ready' | 'error'
  >('idle');
  const [previewError, setPreviewError] = useState<string>();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  useEffect(() => {
    if (!lightboxOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [lightboxOpen]);
  const loadPreview = async () => {
    setPreview(undefined);
    setPreviewError(undefined);
    setPreviewState('granting');
    try {
      const access = await requestAccess();
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(access.mimeType.toLowerCase())) {
        setPreviewState('error');
        setPreviewError(
          access.mimeType === 'application/pdf'
            ? 'This evidence is a PDF. Open it in the secure document viewer.'
            : 'Inline preview is unavailable for this file type. Open the evidence instead.',
        );
        return;
      }
      setPreviewExpiry(access.expiresAt);
      setPreview(access.url);
      setPreviewState('loading');
    } catch {
      setPreviewState('error');
      setPreviewError('A temporary access grant could not be created. Try again.');
    }
  };
  const openEvidence = async () => {
    setPreviewError(undefined);
    try {
      const access = await requestAccess();
      window.open(access.url, '_blank', 'noopener,noreferrer');
    } catch {
      setPreviewError('The evidence could not be opened. Request a new temporary grant and retry.');
    }
  };
  return (
    <article className={`admin-evidence-card evidence-mode-${displayMode}`}>
      <div className="evidence-preview">
        {preview ? (
          <button
            aria-label={`View ${label} full size`}
            className="evidence-image-button"
            onClick={() => setLightboxOpen(true)}
          >
            <img
              alt={`${label} secure preview`}
              src={preview}
              onError={() => {
                setPreview(undefined);
                setLightboxOpen(false);
                setPreviewState('error');
                setPreviewError('The preview failed to load or its temporary grant expired.');
              }}
              onLoad={() => setPreviewState('ready')}
            />
          </button>
        ) : (
          <span aria-hidden>Secure evidence</span>
        )}
        {(previewState === 'granting' || previewState === 'loading') && (
          <span className="evidence-loading" role="status">
            {previewState === 'granting' ? 'Requesting secure access…' : 'Loading preview…'}
          </span>
        )}
      </div>
      <div className="evidence-copy">
        <div>
          <strong>{label}</strong>
          {status && <StatusBadge value={status} />}
        </div>
        {note && <small>{note}</small>}
        {previewState === 'ready' && previewExpiry && (
          <small>Temporary preview grant expires {formatDate(previewExpiry)}</small>
        )}
        {previewError && <small className="error-text">{previewError}</small>}
        <div className="table-actions">
          {!preview && (
            <button
              className="quiet"
              disabled={previewState === 'granting'}
              onClick={() => void loadPreview()}
            >
              {previewState === 'error' ? 'Retry secure preview' : 'Load secure preview'}
            </button>
          )}
          {preview && (
            <button
              className="quiet"
              disabled={previewState === 'granting'}
              onClick={() => void loadPreview()}
            >
              Refresh secure preview
            </button>
          )}
          <button className="quiet" onClick={() => void openEvidence()}>
            Open evidence
          </button>
        </div>
      </div>
      {lightboxOpen &&
        preview &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            aria-label={`${label} evidence viewer`}
            aria-modal="true"
            className="evidence-lightbox"
            onClick={() => setLightboxOpen(false)}
            role="dialog"
          >
            <div className="evidence-lightbox-dialog" onClick={(event) => event.stopPropagation()}>
              <div className="evidence-lightbox-header">
                <div>
                  <strong>{label}</strong>
                  {previewExpiry && <small>Grant expires {formatDate(previewExpiry)}</small>}
                </div>
                <button
                  aria-label="Close evidence viewer"
                  autoFocus
                  className="quiet compact"
                  onClick={() => setLightboxOpen(false)}
                >
                  ×
                </button>
              </div>
              <img
                alt={`${label} full-size secure evidence`}
                src={preview}
                onError={() => {
                  setPreview(undefined);
                  setLightboxOpen(false);
                  setPreviewState('error');
                  setPreviewError('The secure grant expired or the image could not be loaded.');
                }}
              />
              <button className="quiet" onClick={() => void loadPreview()}>
                Reload secure evidence
              </button>
            </div>
          </div>,
          document.body,
        )}
    </article>
  );
}

export function AdminActionBar({
  title = 'Review actions',
  description,
  children,
  danger = false,
}: {
  readonly title?: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly danger?: boolean;
}) {
  return (
    <aside className={`admin-action-bar ${danger ? 'is-danger' : ''}`}>
      <div>
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      <div className="actions">{children}</div>
    </aside>
  );
}

export function AdminErrorDialog({
  message,
  onClose,
  title = 'Action could not be completed',
}: {
  readonly message: string;
  readonly onClose: () => void;
  readonly title?: string;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  return createPortal(
    <div className="admin-dialog-backdrop" onClick={onClose} role="presentation">
      <div
        aria-labelledby="admin-error-dialog-title"
        aria-modal="true"
        className="admin-error-dialog"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
      >
        <span aria-hidden className="admin-error-dialog-icon">
          !
        </span>
        <div>
          <h2 id="admin-error-dialog-title">{title}</h2>
          <p>{message}</p>
        </div>
        <button autoFocus className="danger" onClick={onClose}>
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function AdminTechnicalDetails({
  summary = 'Technical details',
  children,
}: {
  readonly summary?: string;
  readonly children: ReactNode;
}) {
  return (
    <details className="admin-technical-details">
      <summary>{summary}</summary>
      <div>{children}</div>
    </details>
  );
}

export function EmptyState({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="empty-state">
      <span aria-hidden>✓</span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function DataTable({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <div className="data-table-scroll">
      <table aria-label={label} className="data-table">
        {children}
      </table>
    </div>
  );
}
