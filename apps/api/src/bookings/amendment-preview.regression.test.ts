import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const service = readFileSync(new URL('./amendment-preview.service.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('./bookings.controller.ts', import.meta.url), 'utf8');
const dto = readFileSync(new URL('./bookings.dto.ts', import.meta.url), 'utf8');

describe('booking amendment preview regression', () => {
  it('exposes only the authenticated renter preview endpoint', () => {
    expect(controller).toContain("@Post(':reference/amendment-preview')");
    expect(controller).toContain('this.amendmentPreviews.previewRenter');
    expect(controller).not.toContain("@Post(':reference/amendment')\n  amendmentPreview");
  });

  it('keeps preview observational and does not create amendment lifecycle rows', () => {
    expect(service).not.toMatch(/bookingAmendment\.(?:create|update|delete)/u);
    expect(service).not.toMatch(/bookingAmendmentHold\.(?:create|update|delete)/u);
    expect(service).not.toMatch(/bookingAmendmentSettlement\.(?:create|update|delete)/u);
    expect(service).not.toMatch(/vehicleOccupancy\.(?:create|update|delete)/u);
    expect(service).not.toContain('outboxEvent.create');
  });

  it('reuses quote TTL and the configured secure signing secret', () => {
    expect(service).toContain("getOrThrow('QUOTE_TTL_MINUTES'");
    expect(service).toContain("getOrThrow('TOKEN_HASH_SECRET'");
    expect(service).not.toMatch(/PREVIEW_TTL_(?:MS|MINUTES)/u);
  });

  it('uses original rental policy, current fulfillment policy, and complete-trip pricing', () => {
    expect(service).toContain('booking.pricingSnapshot!.policyVersionId');
    expect(service).toContain("orderBy: { version: 'desc' }");
    expect(service).toContain('priceCompleteTripRental(chargeableDays, originalPolicy!)');
    expect(service).toContain('retainedNonRefundableRentalMinor');
  });

  it('excludes only this booking occupancy while retaining amendment holds', () => {
    expect(service).toContain('this.availability.occupancyConflict');
    expect(service).toContain('excludeBookingId: booking.id');
    expect(service).toContain("'PREPARATION_TIME_CONFLICT'");
    expect(service).not.toContain('latestAvailableReturnAt');
  });

  it('does not expose owner earnings or raw commission in the renter response', () => {
    const responseStart = service.indexOf('return {\n      bookingReference:');
    const responseEnd = service.indexOf('\n    };', responseStart);
    const publicResponse = service.slice(responseStart, responseEnd);
    expect(publicResponse).not.toContain('ownerEarnings');
    expect(publicResponse).not.toContain('commission');
    expect(service).toContain('financialDigest');
  });

  it('accepts partial operational criteria and rejects client financial authority', () => {
    expect(dto).toContain('proposedPickupAt?: string');
    expect(dto).toContain('proposedReturnAt?: string');
    expect(dto).toContain('proposedStartMethod?: StartFulfillmentMethod');
    expect(dto).toContain('proposedEndMethod?: EndFulfillmentMethod');
    expect(dto).not.toContain('additionalPaymentMinor');
    expect(dto).not.toContain('refundMinor');
    expect(dto).not.toContain('pricingPolicyVersion');
  });
});
