import { describe, expect, it } from 'vitest';
import { bookingAmendmentFulfillmentCapabilities } from './booking-projection.service';

const both = {
  supportsOwnerCollection: true,
  supportsOwnerDelivery: true,
  supportsRenterPickup: true,
  supportsRenterReturn: true,
};

function capabilities(
  policy: typeof both,
  overrides: Partial<Parameters<typeof bookingAmendmentFulfillmentCapabilities>[0]> = {},
) {
  return bookingAmendmentFulfillmentCapabilities({
    actualPickupAt: null,
    currentEndMethod: 'RENTER_RETURN',
    currentStartMethod: 'RENTER_PICKUP',
    policy,
    status: 'CONFIRMED',
    ...overrides,
  });
}

describe('booking amendment fulfillment capabilities', () => {
  it('projects pickup/return-only policy as changeable single choices', () => {
    expect(
      capabilities({
        ...both,
        supportsOwnerCollection: false,
        supportsOwnerDelivery: false,
      }),
    ).toMatchObject({
      allowedEndMethods: ['RENTER_RETURN'],
      allowedStartMethods: ['RENTER_PICKUP'],
      endFulfillmentChangeable: true,
      startFulfillmentChangeable: true,
    });
  });

  it('projects symmetric and mixed vehicle-policy capabilities', () => {
    expect(capabilities(both)).toMatchObject({
      allowedEndMethods: ['RENTER_RETURN', 'OWNER_COLLECTION'],
      allowedStartMethods: ['RENTER_PICKUP', 'OWNER_DELIVERY'],
    });
    expect(capabilities({ ...both, supportsOwnerCollection: false })).toMatchObject({
      allowedEndMethods: ['RENTER_RETURN'],
      allowedStartMethods: ['RENTER_PICKUP', 'OWNER_DELIVERY'],
    });
  });

  it('keeps historically booked methods represented after policy drift', () => {
    expect(
      capabilities(
        {
          ...both,
          supportsOwnerCollection: false,
          supportsOwnerDelivery: false,
        },
        { currentEndMethod: 'OWNER_COLLECTION', currentStartMethod: 'OWNER_DELIVERY' },
      ),
    ).toMatchObject({
      allowedEndMethods: ['RENTER_RETURN', 'OWNER_COLLECTION'],
      allowedStartMethods: ['RENTER_PICKUP', 'OWNER_DELIVERY'],
    });
  });

  it('makes ACTIVE and already-picked-up fulfillment read-only', () => {
    expect(capabilities(both, { status: 'ACTIVE' })).toMatchObject({
      endFulfillmentChangeable: false,
      startFulfillmentChangeable: false,
    });
    expect(capabilities(both, { actualPickupAt: new Date() })).toMatchObject({
      endFulfillmentChangeable: false,
      startFulfillmentChangeable: false,
    });
  });
});
