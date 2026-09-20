import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'OwnerDashboardScreen.tsx'),
  'utf8',
);

describe('Owner Dashboard availability summary', () => {
  it('reuses existing rental counters to flag server-derived overdue bookings', () => {
    expect(source).toContain('workflowCompliance?.start.overdue');
    expect(source).toContain('workflowCompliance?.return.overdue');
    expect(source).toContain('attention={startNeedsAttention}');
    expect(source).toContain('attention={returnNeedsAttention}');
    expect(source).toContain("['ACTIVE', 'RETURN_PENDING'].includes(item.status)");
  });
  it('uses a server-authoritative Owner-blocked-today count with a stable zero state', () => {
    expect(source).toContain("queryKey: ['owner-vehicle-dashboard-summary']");
    expect(source).toContain("'/owner/vehicles/dashboard-summary'");
    expect(source).toContain('label="Owner-blocked today"');
    expect(source).toContain('availability.data?.ownerBlockedVehiclesToday ?? 0');
    expect(source).not.toContain('filter((vehicle) => vehicle.availabilityToday');
  });
});
