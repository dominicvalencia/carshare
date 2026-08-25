'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
interface Envelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { readonly message: string };
}
interface Ticket {
  readonly id: string;
  readonly publicReference: string;
  readonly subject: string;
  readonly status: string;
  readonly priority: string;
  readonly createdBy: { readonly email: string | null };
  readonly assignedTo: { readonly email: string | null } | null;
}
interface Report {
  readonly id: string;
  readonly targetType: 'MESSAGE' | 'REVIEW' | 'USER';
  readonly reason: string;
  readonly status: string;
  readonly message: { readonly id: string; readonly body: string } | null;
  readonly review: { readonly id: string; readonly text: string | null } | null;
  readonly reportedUser: { readonly id?: string; readonly email: string | null } | null;
}

export function Phase10AdminPanels({ accessToken }: { readonly accessToken: string }) {
  const client = useQueryClient();
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null);
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
    if (!response.ok || !envelope.success)
      throw new Error(envelope.error?.message ?? 'Request failed.');
    return envelope.data as T;
  };
  const tickets = useQuery({
    queryKey: ['phase10-support'],
    queryFn: () => api<Ticket[]>('/admin/support/tickets'),
  });
  const reports = useQuery({
    queryKey: ['phase10-reports'],
    queryFn: () => api<Report[]>('/admin/moderation/reports'),
  });
  const postReply = useMutation({
    mutationFn: ({ visibility }: { visibility: 'USER_VISIBLE' | 'INTERNAL' }) =>
      api(`/admin/support/tickets/${selectedTicket}/messages`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `admin-${Date.now()}-${visibility}` },
        body: JSON.stringify({ body: reply, visibility }),
      }),
    onSuccess: () => {
      setReply('');
      void client.invalidateQueries({ queryKey: ['phase10-support'] });
    },
  });
  const updateTicket = useMutation({
    mutationFn: ({ reference, status }: { reference: string; status: string }) =>
      api(`/admin/support/tickets/${reference}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, reason: `Support workflow moved to ${status}` }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['phase10-support'] }),
  });
  const resolve = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: 'RESOLVED' | 'DISMISSED' }) =>
      api(`/admin/moderation/reports/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          outcome,
          reason: `Administrator ${outcome.toLowerCase()} this report.`,
        }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['phase10-reports'] }),
  });
  const moderate = useMutation({
    mutationFn: async (report: Report) => {
      if (report.targetType === 'MESSAGE' && report.message)
        await api(`/admin/messages/${report.message.id}/moderate`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'Removed after administrator review.' }),
        });
      if (report.targetType === 'REVIEW' && report.review)
        await api(`/admin/reviews/${report.review.id}/moderation`, {
          method: 'POST',
          body: JSON.stringify({ status: 'HIDDEN', reason: 'Hidden after administrator review.' }),
        });
      return api(`/admin/moderation/reports/${report.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ outcome: 'RESOLVED', reason: 'Reported content was moderated.' }),
      });
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['phase10-reports'] }),
  });
  return (
    <>
      <section className="admin-card vehicle-review-card">
        <span className="eyebrow">CUSTOMER SUPPORT</span>
        <h2>Support queue</h2>
        {tickets.isError && <p className="error-text">{tickets.error.message}</p>}
        {tickets.data?.map((ticket) => (
          <article className="review-row" key={ticket.id}>
            <div>
              <strong>{ticket.subject}</strong>
              <span>
                {ticket.publicReference} · {ticket.status} · {ticket.priority} ·{' '}
                {ticket.createdBy.email}
              </span>
              <span>
                {ticket.assignedTo ? `Assigned to ${ticket.assignedTo.email}` : 'Unassigned'}
              </span>
            </div>
            <div className="actions">
              <button className="quiet" onClick={() => setSelectedTicket(ticket.publicReference)}>
                Reply
              </button>
              <button
                onClick={() =>
                  updateTicket.mutate({ reference: ticket.publicReference, status: 'RESOLVED' })
                }
              >
                Resolve
              </button>
            </div>
          </article>
        ))}
        {selectedTicket && (
          <div className="vehicle-detail">
            <h3>Reply to {selectedTicket}</h3>
            <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={4} />
            <div className="actions">
              <button
                disabled={!reply.trim()}
                onClick={() => postReply.mutate({ visibility: 'USER_VISIBLE' })}
              >
                Send reply
              </button>
              <button
                className="quiet"
                disabled={!reply.trim()}
                onClick={() => postReply.mutate({ visibility: 'INTERNAL' })}
              >
                Add internal note
              </button>
              <button className="quiet" onClick={() => setSelectedTicket(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="admin-card vehicle-review-card">
        <span className="eyebrow">TRUST & SAFETY</span>
        <h2>Moderation reports</h2>
        {reports.isError && <p className="error-text">{reports.error.message}</p>}
        {reports.data?.map((report) => (
          <article className="review-row" key={report.id}>
            <div>
              <strong>
                {report.targetType} · {report.reason}
              </strong>
              <span>
                {report.message?.body ??
                  report.review?.text ??
                  report.reportedUser?.email ??
                  'Reported content'}
              </span>
              <span>{report.status}</span>
            </div>
            <div className="actions">
              {report.targetType !== 'USER' && (
                <button className="danger" onClick={() => moderate.mutate(report)}>
                  Moderate
                </button>
              )}
              <button onClick={() => resolve.mutate({ id: report.id, outcome: 'RESOLVED' })}>
                Resolve
              </button>
              <button
                className="quiet"
                onClick={() => resolve.mutate({ id: report.id, outcome: 'DISMISSED' })}
              >
                Dismiss
              </button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
