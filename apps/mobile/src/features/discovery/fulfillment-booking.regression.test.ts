import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const discovery = readFileSync(
  resolve(process.cwd(), 'src/features/discovery/DiscoveryScreen.tsx'),
  'utf8',
);
const renter = readFileSync(
  resolve(process.cwd(), 'src/features/bookings/MyBookingsScreen.tsx'),
  'utf8',
);
const owner = readFileSync(
  resolve(process.cwd(), 'src/features/bookings/OwnerBookingRequestsScreen.tsx'),
  'utf8',
);

describe('B3 booking fulfillment presentation', () => {
  it('supports all start/end selections and same-as-delivery without client fee authority', () => {
    expect(discovery).toContain('Start of rental');
    expect(discovery).toContain("label: 'Pick up'");
    expect(discovery).toContain("label: 'Delivery'");
    expect(discovery).toContain('End of rental');
    expect(discovery).toContain("label: 'Return it'");
    expect(discovery).toContain("label: 'Collection'");
    expect(discovery).toContain('styles.handoverStaticTitle}>Pick up');
    expect(discovery).toContain('styles.handoverStaticTitle}>Return it');
    expect(discovery).toContain('vehicle.fulfillment.ownerDeliveryAvailable');
    expect(discovery).toContain('vehicle.fulfillment.ownerCollectionAvailable');
    expect(discovery).toContain('Same as delivery location');
    expect(discovery).not.toContain('insideRadius');
    expect(discovery).not.toContain('serviceable: true');
  });

  it('keeps authoritative fee lines in review and contractual terms in both party details', () => {
    expect(discovery).toContain('quote.lines.map');
    expect(renter).toContain('Handover details');
    expect(renter).toContain('label="Start of rental"');
    expect(renter).toContain('label="End of rental"');
    expect(owner).toContain('>\n          Handover\n        </Text>');
    expect(owner).toContain('Deliver to renter');
  });
});
