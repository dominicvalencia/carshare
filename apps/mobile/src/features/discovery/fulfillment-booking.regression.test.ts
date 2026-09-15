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
    expect(discovery).toContain('How would you like to receive the car?');
    expect(discovery).toContain('Pick up the car');
    expect(discovery).toContain('Have it delivered');
    expect(discovery).toContain('How would you like to return the car?');
    expect(discovery).toContain('Have the owner collect it');
    expect(discovery).toContain('Pickup only');
    expect(discovery).toContain('Delivery only');
    expect(discovery).toContain('Return to owner');
    expect(discovery).toContain('Owner collection');
    expect(discovery).toContain('renterPickupAvailable !==');
    expect(discovery).toContain('vehicle.fulfillment.ownerDeliveryAvailable');
    expect(discovery).toContain('Same as delivery location');
    expect(discovery).not.toContain('insideRadius');
    expect(discovery).not.toContain('serviceable: true');
  });

  it('keeps authoritative fee lines in review and contractual terms in both party details', () => {
    expect(discovery).toContain('quote.lines.map');
    expect(renter).toContain('Contractual handover');
    expect(renter).toContain("How you'll receive the car");
    expect(owner).toContain('Handover request');
    expect(owner).toContain('Deliver to renter');
  });
});
