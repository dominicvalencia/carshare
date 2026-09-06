'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import {
  AdminActionBar,
  AdminDefinitionList,
  AdminDetailHeader,
  AdminSection,
  AdminSummaryCard,
  AdminSummaryGrid,
  AdminTimeline,
  DataTable,
  EmptyState,
  StatusBadge,
} from './AdminPrimitives';
import { adminLabel, formatDate } from './admin-presentation';

import { API_URL } from './admin-environment';
interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { message: string };
}
interface Message {
  id: string;
  body: string;
  visibility: string;
  createdAt: string;
  author: { email: string | null };
}
interface Ticket {
  id: string;
  publicReference: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  createdAt: string;
  lastActivityAt: string;
  resolvedAt?: string | null;
  createdBy: { email: string | null; profile?: { displayName?: string | null } | null };
  assignedTo: { email: string | null } | null;
  messages?: Message[];
}
interface Report {
  id: string;
  targetType: 'MESSAGE' | 'REVIEW' | 'USER';
  reason: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionReason: string | null;
  reporter: { email: string | null };
  message: { id: string; body: string } | null;
  review: { id: string; text: string | null } | null;
  reportedUser: { id?: string; email: string | null; status?: string } | null;
}

export function Phase10AdminPanels({
  accessToken,
  module,
  initialSelectedId,
  onUnauthorized,
}: {
  accessToken: string;
  module: 'support' | 'trust-safety';
  initialSelectedId?: string;
  onUnauthorized: () => void;
}) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [reply, setReply] = useState('');
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
  const tickets = useQuery({
    queryKey: ['support-queue'],
    queryFn: () => api<Ticket[]>('/admin/support/tickets'),
    enabled: module === 'support',
  });
  const ticket = useQuery({
    queryKey: ['support-detail', selectedId],
    queryFn: () => api<Ticket>(`/admin/support/tickets/${selectedId}`),
    enabled: module === 'support' && Boolean(selectedId),
  });
  const reports = useQuery({
    queryKey: ['moderation-queue'],
    queryFn: () => api<Report[]>('/admin/moderation/reports'),
    enabled: module === 'trust-safety',
  });
  const report = useQuery({
    queryKey: ['moderation-detail', selectedId],
    queryFn: () => api<Report>(`/admin/moderation/reports/${selectedId}`),
    enabled: module === 'trust-safety' && Boolean(selectedId),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['support-queue'] });
    void client.invalidateQueries({ queryKey: ['support-detail', selectedId] });
    void client.invalidateQueries({ queryKey: ['moderation-queue'] });
    void client.invalidateQueries({ queryKey: ['moderation-detail', selectedId] });
  };
  const postReply = useMutation({
    mutationFn: (visibility: 'USER_VISIBLE' | 'INTERNAL') =>
      api(`/admin/support/tickets/${selectedId}/messages`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `admin-${Date.now()}-${visibility}` },
        body: JSON.stringify({ body: reply, visibility }),
      }),
    onSuccess: () => {
      setReply('');
      refresh();
    },
  });
  const updateTicket = useMutation({
    mutationFn: (reference: string) =>
      api(`/admin/support/tickets/${reference}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'RESOLVED',
          reason: 'Support workflow resolved after review.',
        }),
      }),
    onSuccess: refresh,
  });
  const resolve = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: 'RESOLVED' | 'DISMISSED' }) =>
      api(`/admin/moderation/reports/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          outcome,
          reason: `Administrator ${outcome.toLowerCase()} this report after review.`,
        }),
      }),
    onSuccess: refresh,
  });
  const moderate = useMutation({
    mutationFn: async (item: Report) => {
      if (item.targetType === 'MESSAGE' && item.message)
        await api(`/admin/messages/${item.message.id}/moderate`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'Removed after administrator review.' }),
        });
      if (item.targetType === 'REVIEW' && item.review)
        await api(`/admin/reviews/${item.review.id}/moderation`, {
          method: 'POST',
          body: JSON.stringify({ status: 'HIDDEN', reason: 'Hidden after administrator review.' }),
        });
      return api(`/admin/moderation/reports/${item.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ outcome: 'RESOLVED', reason: 'Reported content was moderated.' }),
      });
    },
    onSuccess: refresh,
  });

  if (module === 'support') {
    if (ticket.data)
      return (
        <SupportDetail
          ticket={ticket.data}
          reply={reply}
          setReply={setReply}
          postReply={postReply}
          updateTicket={updateTicket}
        />
      );
    return (
      <section className="admin-card module-support">
        <span className="eyebrow">Customer support</span>
        <h2>Support queue</h2>
        {(tickets.isLoading || ticket.isLoading) && (
          <div className="state-panel">Loading support cases…</div>
        )}
        {(tickets.error || ticket.error) && (
          <p className="error-text">{(tickets.error ?? ticket.error)?.message}</p>
        )}
        {tickets.data?.length === 0 && (
          <EmptyState
            title="No support cases"
            description="There are currently no customer support cases requiring attention."
          />
        )}
        {tickets.data && tickets.data.length > 0 && (
          <DataTable label="Support cases">
            <thead>
              <tr>
                <th>Case</th>
                <th>Subject</th>
                <th>Customer</th>
                <th>Priority</th>
                <th>Assignment</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {tickets.data.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.publicReference}</strong>
                  </td>
                  <td>{item.subject}</td>
                  <td>{item.createdBy.email ?? 'No email'}</td>
                  <td>
                    <StatusBadge value={item.priority} />
                  </td>
                  <td>{item.assignedTo?.email ?? 'Unassigned'}</td>
                  <td>
                    <StatusBadge value={item.status} />
                  </td>
                  <td>
                    <Link
                      href={`/admin/support/${item.publicReference}`}
                      onClick={() => setSelectedId(item.publicReference)}
                    >
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
    );
  }
  if (report.data)
    return <TrustDetail report={report.data} resolve={resolve} moderate={moderate} />;
  return (
    <section className="admin-card module-trust-safety">
      <span className="eyebrow">Trust &amp; Safety</span>
      <h2>Moderation reports</h2>
      {(reports.isLoading || report.isLoading) && (
        <div className="state-panel">Loading moderation reports…</div>
      )}
      {(reports.error || report.error) && (
        <p className="error-text">{(reports.error ?? report.error)?.message}</p>
      )}
      {reports.data?.length === 0 && (
        <EmptyState
          title="No moderation reports"
          description="There are no trust and safety reports awaiting review."
        />
      )}
      {reports.data && reports.data.length > 0 && (
        <DataTable label="Moderation reports">
          <thead>
            <tr>
              <th>Target</th>
              <th>Reason</th>
              <th>Reported content</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {reports.data.map((item) => (
              <tr key={item.id}>
                <td>
                  <StatusBadge value={item.targetType} />
                </td>
                <td>
                  <strong>{item.reason}</strong>
                </td>
                <td>{reportedContent(item)}</td>
                <td>
                  <StatusBadge value={item.status} />
                </td>
                <td>
                  <Link
                    href={`/admin/trust-safety/${item.id}`}
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
    </section>
  );
}

function SupportDetail({
  ticket,
  reply,
  setReply,
  postReply,
  updateTicket,
}: {
  ticket: Ticket;
  reply: string;
  setReply: (value: string) => void;
  postReply: {
    isPending: boolean;
    error: Error | null;
    mutate: (value: 'USER_VISIBLE' | 'INTERNAL') => void;
  };
  updateTicket: { isPending: boolean; error: Error | null; mutate: (value: string) => void };
}) {
  return (
    <section className="admin-card detail-page module-support">
      <AdminDetailHeader
        backHref="/admin/support"
        backLabel="Support queue"
        eyebrow="Customer support case"
        title={ticket.publicReference}
        status={ticket.status}
        description={ticket.subject}
      />
      <AdminSummaryGrid>
        <AdminSummaryCard
          label="Customer"
          value={ticket.createdBy.profile?.displayName ?? ticket.createdBy.email ?? 'Unknown'}
          detail={ticket.createdBy.email}
        />
        <AdminSummaryCard
          label="Priority"
          value={<StatusBadge value={ticket.priority} />}
          detail={adminLabel(ticket.category)}
        />
        <AdminSummaryCard
          label="Assignment"
          value={ticket.assignedTo?.email ?? 'Unassigned'}
          detail={`Last activity ${formatDate(ticket.lastActivityAt)}`}
        />
      </AdminSummaryGrid>
      <AdminSection
        title="Conversation"
        description="Internal notes remain visible only to authorized support staff."
      >
        <AdminTimeline
          events={(ticket.messages ?? []).map((message) => ({
            id: message.id,
            title:
              message.visibility === 'INTERNAL'
                ? 'Internal note'
                : (message.author.email ?? 'Customer message'),
            occurredAt: message.createdAt,
            detail: message.body,
            status: message.visibility,
          }))}
        />
        {(ticket.messages ?? []).length === 0 && (
          <EmptyState title="No messages" description="This case has no recorded conversation." />
        )}
      </AdminSection>
      <AdminActionBar
        title="Respond to case"
        description="Choose a customer-visible reply or an internal operational note."
      >
        <textarea
          aria-label="Support response"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          rows={4}
        />
        <button
          disabled={!reply.trim() || postReply.isPending}
          onClick={() => postReply.mutate('USER_VISIBLE')}
        >
          Send reply
        </button>
        <button
          className="quiet"
          disabled={!reply.trim() || postReply.isPending}
          onClick={() => postReply.mutate('INTERNAL')}
        >
          Add internal note
        </button>
        {ticket.status !== 'RESOLVED' && (
          <button
            className="quiet"
            disabled={updateTicket.isPending}
            onClick={() => updateTicket.mutate(ticket.publicReference)}
          >
            Resolve case
          </button>
        )}
      </AdminActionBar>
      {(postReply.error || updateTicket.error) && (
        <p className="error-text">{(postReply.error ?? updateTicket.error)?.message}</p>
      )}
    </section>
  );
}

function TrustDetail({
  report,
  resolve,
  moderate,
}: {
  report: Report;
  resolve: {
    isPending: boolean;
    error: Error | null;
    mutate: (value: { id: string; outcome: 'RESOLVED' | 'DISMISSED' }) => void;
  };
  moderate: { isPending: boolean; error: Error | null; mutate: (value: Report) => void };
}) {
  return (
    <section className="admin-card detail-page module-trust-safety">
      <AdminDetailHeader
        backHref="/admin/trust-safety"
        backLabel="Trust & Safety queue"
        eyebrow="Moderation report"
        title={adminLabel(report.targetType)}
        status={report.status}
        description={report.reason}
      />
      <AdminSummaryGrid>
        <AdminSummaryCard
          label="Reported by"
          value={report.reporter.email ?? 'Unknown'}
          detail={formatDate(report.createdAt)}
        />
        <AdminSummaryCard
          label="Target"
          value={adminLabel(report.targetType)}
          detail={report.reportedUser?.email ?? 'Content report'}
        />
        <AdminSummaryCard
          label="Resolution"
          value={report.resolutionReason ?? 'Pending review'}
          detail={report.resolvedAt ? formatDate(report.resolvedAt) : 'Not resolved'}
        />
      </AdminSummaryGrid>
      <AdminSection title="Reported content">
        <AdminDefinitionList
          items={[
            { label: 'Reason', value: report.reason },
            { label: 'Content', value: reportedContent(report) },
            {
              label: 'User status',
              value: report.reportedUser?.status ? (
                <StatusBadge value={report.reportedUser.status} />
              ) : (
                'Not applicable'
              ),
            },
          ]}
        />
      </AdminSection>
      {report.status === 'OPEN' && (
        <AdminActionBar
          title="Moderation decision"
          description="Actions are audited and should reflect the reviewed content."
        >
          {report.targetType !== 'USER' && (
            <button
              className="danger"
              disabled={moderate.isPending}
              onClick={() => moderate.mutate(report)}
            >
              Moderate content
            </button>
          )}
          <button
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ id: report.id, outcome: 'RESOLVED' })}
          >
            Resolve
          </button>
          <button
            className="quiet"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ id: report.id, outcome: 'DISMISSED' })}
          >
            Dismiss
          </button>
        </AdminActionBar>
      )}
      {(resolve.error || moderate.error) && (
        <p className="error-text">{(resolve.error ?? moderate.error)?.message}</p>
      )}
    </section>
  );
}

function reportedContent(report: Report) {
  return (
    report.message?.body ??
    report.review?.text ??
    report.reportedUser?.email ??
    'No content snapshot available'
  );
}
