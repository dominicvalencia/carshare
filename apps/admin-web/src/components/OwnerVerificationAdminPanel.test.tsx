import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OwnerVerificationAdminPanel } from './OwnerVerificationAdminPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function response(data: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify({ data, success: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    }),
  );
}

function renderPanel(initialSelectedId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OwnerVerificationAdminPanel
        accessToken="test-admin-token"
        {...(initialSelectedId ? { initialSelectedId } : {})}
        onUnauthorized={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('OwnerVerificationAdminPanel', () => {
  it('renders the pending queue with the correct bookmarkable detail route', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      response([
        {
          id: 'owner-profile-id',
          legalName: 'Jamie Lim',
          status: 'PENDING_VERIFICATION',
          submittedAt: null,
          user: { email: 'owner@example.test', profile: null },
        },
      ]),
    );
    renderPanel();
    const link = await screen.findByRole('link', { name: 'Review' });
    expect(link.getAttribute('href')).toBe('/admin/verification/owners/owner-profile-id');
    expect(screen.getByText('Jamie Lim')).not.toBeNull();
  });

  it('renders optional null owner fields without crashing the detail page', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/admin/owners/owner-profile-id'))
        return response({
          id: 'owner-profile-id',
          status: 'PENDING_VERIFICATION',
          legalName: null,
          submittedAt: null,
          contactNumber: null,
          addressLine1: null,
          barangay: null,
          city: null,
          province: null,
          postalCode: null,
          verifiedAt: null,
          rejectedAt: null,
          suspendedAt: null,
          rejectionReason: null,
          suspensionReason: null,
          user: {
            email: null,
            profile: null,
            mobileNumber: null,
            emailVerifiedAt: null,
            mobileVerifiedAt: null,
            createdAt: '2026-09-01T00:00:00.000Z',
          },
          verifications: [],
        });
      return response([]);
    });
    renderPanel('owner-profile-id');
    expect(await screen.findByRole('heading', { name: 'Unnamed owner' })).not.toBeNull();
    expect(screen.getAllByText('Not provided').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Owner queue/ }).getAttribute('href')).toBe(
      '/admin/verification/owners',
    );
  });
});
