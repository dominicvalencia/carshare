import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const reviewPanel = readFileSync(resolve(here, 'ReviewPanel.tsx'), 'utf8');
const profileReviews = readFileSync(resolve(here, 'ReviewsScreen.tsx'), 'utf8');
const marketplaceReviews = readFileSync(resolve(here, 'MarketplaceReviewsScreens.tsx'), 'utf8');
const discovery = readFileSync(resolve(here, '../discovery/DiscoveryScreen.tsx'), 'utf8');
const ownerRequests = readFileSync(
  resolve(here, '../bookings/OwnerBookingRequestsScreen.tsx'),
  'utf8',
);
const ownerRentals = readFileSync(resolve(here, '../rentals/OwnerRentalsScreen.tsx'), 'utf8');

describe('review publication refresh', () => {
  it('routes successful submissions through the shared counterpart-safe invalidation helper', () => {
    expect(reviewPanel).toContain('invalidateReviewAuthorities(client, bookingReference)');
    expect(reviewPanel).not.toContain(
      "client.invalidateQueries({ queryKey: ['review-eligibility', bookingReference] })",
    );
  });

  it('refreshes Profile Reviews, Host Profile, and full public reviews on focus', () => {
    expect(profileReviews).toContain(
      'useRefreshOnFocusAndForeground(() => void reviews.refetch())',
    );
    expect(marketplaceReviews).toContain(
      'useRefreshOnFocusAndForeground(() => void reviews.refetch())',
    );
    expect(marketplaceReviews).toContain(
      'useRefreshOnFocusAndForeground(() => void profile.refetch())',
    );
  });

  it('refreshes Vehicle Detail aggregate, preview, and host authority together on focus', () => {
    expect(discovery).toContain('void detail.refetch()');
    expect(discovery).toContain(
      "client.invalidateQueries({ queryKey: ['public-review-preview'] })",
    );
    expect(discovery).toContain("client.invalidateQueries({ queryKey: ['public-host'] })");
  });

  it('keeps relevant Owner booking screens focus-refreshed without adding polling', () => {
    expect(ownerRequests).toContain('void requests.refetch()');
    expect(ownerRequests).toContain('if (selected) void detail.refetch()');
    expect(ownerRentals).toContain('useRefreshOnFocusAndForeground(() => void rentals.refetch())');
    expect(ownerRequests).not.toContain('refetchInterval: 1_000');
    expect(ownerRentals).not.toContain('refetchInterval: 1_000');
  });
});
