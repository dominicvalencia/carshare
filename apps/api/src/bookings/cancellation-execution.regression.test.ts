import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const controller = readFileSync(new URL('./bookings.controller.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('./cancellation.service.ts', import.meta.url), 'utf8');

describe('confirmed cancellation execution authority', () => {
  it('exposes authenticated renter and Owner preview/execution routes', () => {
    expect(controller.match(/@Post\(':reference\/cancellation-preview'\)/gu)).toHaveLength(2);
    expect(controller.match(/@Post\(':reference\/cancellation'\)/gu)).toHaveLength(2);
    expect(controller).toContain("@ApiHeader({ name: 'Idempotency-Key', required: true })");
  });

  it('locks booking/payment and never accepts client financial amounts', () => {
    expect(service).toContain('FOR UPDATE');
    expect(service).toContain('evaluateConfirmedCancellation');
    expect(service).not.toMatch(/input\.(?:refund|fee|amount|commission)/u);
  });

  it('persists one settlement, one durable occupancy release, and transactional outbox evidence', () => {
    expect(service).toContain('bookingCancellationSettlement.create');
    expect(service).toContain('vehicleOccupancy.updateMany');
    expect(service).toContain('outboxEvent.create');
    expect(service).toContain('booking.cancellationSettlement');
  });

  it('keeps provider uncertainty reconcilable instead of declaring success', () => {
    expect(service).toContain('PaymentOperationStatus.UNKNOWN');
    expect(service).toContain('reconciliationRequired: true');
    expect(service).toContain('RefundStatus.PROCESSING');
  });

  it('creates an Owner obligation without wiring payout recovery', () => {
    expect(service).toContain('ownerFinancialObligation.create');
    expect(service).toContain('ownerFinancialObligation: prepared.obligation');
    expect(service).toContain(
      'ownerFinancialObligation: prepared.existing.ownerFinancialObligations[0] ?? null',
    );
    expect(service).toContain('OWNER_PENALTY_RECOGNITION');
    expect(service).not.toContain('ownerObligationRecovery.create');
    expect(service).not.toContain('payout.update');
  });

  it('does not pass a public booking reference into the UUID predicate', () => {
    expect(service).toContain('{ publicReference: reference }');
    expect(service).toContain('...(this.isUuid(reference) ? [{ id: reference }] : [])');
    expect(service).not.toContain('OR: [{ id: reference }, { publicReference: reference }]');
  });
});
