import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'DiscoveryScreen.tsx'),
  'utf8',
);
const projection = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../api/src/discovery/public-projection.service.ts',
  ),
  'utf8',
);
const detail = source.slice(
  source.indexOf('function VehicleView'),
  source.indexOf('function QuoteCard'),
);
const hostStart = detail.indexOf('title="Meet your host"');
const host = detail.slice(hostStart, detail.indexOf('</Pressable>', hostStart));

describe('Task 14D-2 Vehicle Detail host section', () => {
  it('shows the projected host identity, avatar, and safe fallback', () => {
    expect(host).toContain('{vehicle.owner.displayName}');
    expect(host).toContain('vehicle.owner.avatar?.contentPath');
    expect(host).toContain("accessibilityLabel={`${vehicle.owner.displayName}'s profile photo`}");
    expect(host).toContain('profile photo unavailable');
    expect(host).toContain('name="person"');
  });

  it('announces verified status without inventing marketplace badges', () => {
    expect(host).toContain('vehicle.owner.verified &&');
    expect(host).toContain('accessibilityLabel="Verified host"');
    expect(host).not.toMatch(/Superhost/i);
  });

  it('omits unavailable metrics and uses singular/plural labels', () => {
    expect(host).toContain('vehicle.owner.rating?.averageRating &&');
    expect(host).toContain('vehicle.owner.rating.reviewCount > 0');
    expect(host).toContain("vehicle.owner.rating.reviewCount === 1 ? 'Review' : 'Reviews'");
    expect(host).toContain("typeof hostSummary.data?.completedRentalCount === 'number'");
    expect(host).toContain("? 'Completed rental'");
    expect(host).toContain(": 'Completed rentals'");
    expect(host).toContain('memberSinceYear && Number.isFinite(memberSinceYear)');
    expect(host).toContain('Hosting since');
  });

  it('reuses the existing public Host Profile authority and navigation', () => {
    expect(detail).toContain("queryKey: ['public-host', vehicle?.owner.publicReference]");
    expect(detail).toContain('`/hosts/${vehicle!.owner.publicReference}`');
    expect(host).toContain('View host profile');
    expect(host).toContain(
      "navigation.navigate('HostProfile', { hostReference: vehicle.owner.publicReference })",
    );
  });

  it('uses only the renter-safe public owner projection', () => {
    expect(projection).toContain('avatar:');
    expect(projection).toContain('memberSince: vehicle.ownerProfile.user.createdAt');
    expect(projection).toContain('publicReference: vehicle.ownerProfile.publicReference');
    for (const privateField of ['email', 'phone', 'legalName', 'bank', 'payout', 'earnings'])
      expect(host).not.toContain(privateField);
  });
});
