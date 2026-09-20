import { describe, expect, it } from 'vitest';
import { workflowCompliance } from './workflow-compliance';

const now = new Date('2026-09-17T12:00:00Z');
const booking = () => ({
  status: 'READY_FOR_PICKUP',
  handoverWorkflowVersion: 1,
  rentalStart: new Date('2026-09-17T08:00:00Z'),
  rentalEnd: new Date('2026-09-17T09:00:00Z'),
  pickupWindowEnd: new Date('2026-09-17T09:00:00Z'),
  actualPickupAt: null as Date | null,
  actualReturnAt: null as Date | null,
  operationalHold: false,
  fulfillmentSnapshot: { startMethod: 'OWNER_DELIVERY', endMethod: 'OWNER_COLLECTION' },
  handoverTravelEvents: [] as { phase: string; status: string }[],
  inspections: [] as Parameters<typeof workflowCompliance>[0]['inspections'],
});

describe('server workflow compliance projection', () => {
  it('valid phase-specific B4 waivers skip evidence, never custody or travel', () => {
    const b: Parameters<typeof workflowCompliance>[0] = booking();
    b.handoverEvidenceWaivers = [{ phase: 'START' }, { phase: 'RETURN' }];
    expect(workflowCompliance(b, 120, null, now).start.outstandingStep).toBe(
      'OWNER_DELIVERY_ARRIVAL_REQUIRED',
    );
    b.handoverTravelEvents.push({ phase: 'START', status: 'ARRIVED' });
    expect(workflowCompliance(b, 120, null, now).start.outstandingStep).toBe(
      'RENTER_HANDOVER_TIME_CONFIRMATION_REQUIRED',
    );
    b.pickupHandoverResponse = { decision: 'CONFIRMED' };
    expect(workflowCompliance(b, 120, null, now).start).toMatchObject({
      evidenceOutcome: 'WAIVED',
      custodyRecorded: false,
      outstandingStep: 'PICKUP_VERIFICATION_REQUIRED',
    });
    b.status = 'RETURN_PENDING';
    b.actualPickupAt = now;
    expect(workflowCompliance(b, 120, null, now).return.outstandingStep).toBe(
      'OWNER_COLLECTION_ARRIVAL_REQUIRED',
    );
    b.handoverTravelEvents.push({ phase: 'RETURN', status: 'ARRIVED' });
    expect(workflowCompliance(b, 120, null, now).return).toMatchObject({
      evidenceOutcome: 'WAIVED',
      custodyRecorded: false,
      outstandingStep: 'OWNER_RETURN_RECEIPT_REQUIRED',
    });
    b.operationalHold = true;
    expect(workflowCompliance(b, 120, 'OPERATIONS_HOLD', now).return.outstandingStep).toBe(
      'RETURN_DISPUTE_OR_HOLD',
    );
    b.handoverWorkflowVersion = null;
    b.status = 'READY_FOR_PICKUP';
    b.actualPickupAt = null;
    b.operationalHold = false;
    expect(workflowCompliance(b, 120, null, now).start.evidenceOutcome).toBe('PENDING');
  });
  it('prioritizes missing delivery arrival and never infers custody from overdue', () => {
    const result = workflowCompliance(booking(), 120, 'OWNER_INSPECTION_REQUIRED', now);
    expect(result.start).toMatchObject({
      overdue: true,
      outstandingStep: 'OWNER_DELIVERY_ARRIVAL_REQUIRED',
      custodyRecorded: false,
    });
  });
  it('arrival advances to inspection, not custody or payout approval', () => {
    const b = booking();
    b.handoverTravelEvents.push({ phase: 'START', status: 'ARRIVED' });
    expect(workflowCompliance(b, 120, 'OWNER_INSPECTION_REQUIRED', now).start.outstandingStep).toBe(
      'OWNER_INSPECTION_REQUIRED',
    );
  });
  it('uses scheduled return plus server grace even without an inspection', () => {
    const b = booking();
    b.status = 'ACTIVE';
    b.actualPickupAt = now;
    const result = workflowCompliance(b, 120, 'RENTER_RETURN_INSPECTION_REQUIRED', now);
    expect(result.start.overdue).toBe(false);
    expect(result.return).toMatchObject({
      overdue: true,
      outstandingStep: 'RENTER_RETURN_START_REQUIRED',
      custodyRecorded: false,
    });
    expect(result.return.graceBoundary.toISOString()).toBe('2026-09-17T11:00:00.000Z');
  });
  it('does not mark overdue at the exact boundary or before it', () => {
    const b = booking();
    b.status = 'ACTIVE';
    expect(workflowCompliance(b, 120, null, new Date('2026-09-17T11:00:00Z')).return.overdue).toBe(
      false,
    );
    expect(workflowCompliance(b, 120, null, new Date('2026-09-17T10:00:00Z')).return.overdue).toBe(
      false,
    );
  });
  it('clears return overdue after authoritative physical return, including disputed return', () => {
    const b = booking();
    b.status = 'RETURNED';
    b.actualReturnAt = now;
    expect(workflowCompliance(b, 120, null, now).return).toMatchObject({
      overdue: false,
      custodyRecorded: true,
      outstandingStep: null,
    });
  });
  it('preserves explicit legacy and unknown classifications', () => {
    const b: Parameters<typeof workflowCompliance>[0] = booking();
    b.handoverWorkflowVersion = null;
    expect(workflowCompliance(b, 120, null, now).workflow).toBe('LEGACY');
    b.handoverWorkflowVersion = 2;
    expect(workflowCompliance(b, 120, 'UNSUPPORTED_HANDOVER_WORKFLOW', now).workflow).toBe(
      'UNSUPPORTED',
    );
  });
  it('does not backdate or mutate contractual times', () => {
    const b = booking();
    const before = JSON.stringify(b);
    workflowCompliance(b, 120, null, now);
    expect(JSON.stringify(b)).toBe(before);
  });
  it('projects renter review, resolution, verification and Operations prerequisites precisely', () => {
    const b = booking();
    b.handoverTravelEvents.push({ phase: 'START', status: 'ARRIVED' });
    b.inspections.push({ type: 'PICKUP', confirmations: [] });
    expect(workflowCompliance(b, 120, null, now).start.outstandingStep).toBe(
      'RENTER_REVIEW_REQUIRED',
    );
    const renter = {
      role: 'RENTER',
      decision: 'DISAGREED',
      discrepancyResponses: [] as Parameters<
        typeof workflowCompliance
      >[0]['inspections'][number]['confirmations'][number]['discrepancyResponses'],
    };
    b.inspections[0]!.confirmations.push(renter);
    expect(workflowCompliance(b, 120, null, now).start.outstandingStep).toBe(
      'DISCREPANCY_RESOLUTION_REQUIRED',
    );
    renter.discrepancyResponses.push({
      resolutionReview: { decision: 'ACCEPTED', operationsResolution: null },
    });
    expect(workflowCompliance(b, 120, null, now).start.outstandingStep).toBe(
      'PICKUP_VERIFICATION_REQUIRED',
    );
    b.operationalHold = true;
    expect(workflowCompliance(b, 120, null, now).start.outstandingStep).toBe('OPERATIONS_HOLD');
  });
  it('projects collection arrival before inspection and Owner review before completion', () => {
    const b = booking();
    b.status = 'RETURN_PENDING';
    expect(workflowCompliance(b, 120, null, now).return.outstandingStep).toBe(
      'OWNER_COLLECTION_ARRIVAL_REQUIRED',
    );
    b.handoverTravelEvents.push({ phase: 'RETURN', status: 'ARRIVED' });
    expect(workflowCompliance(b, 120, null, now).return.outstandingStep).toBe(
      'RENTER_RETURN_INSPECTION_REQUIRED',
    );
    b.inspections.push({ type: 'RETURN', confirmations: [] });
    expect(workflowCompliance(b, 120, null, now).return.outstandingStep).toBe(
      'OWNER_RETURN_REVIEW_REQUIRED',
    );
    b.inspections[0]!.confirmations.push({
      role: 'OWNER',
      decision: 'DISAGREED',
      discrepancyResponses: [],
    });
    expect(workflowCompliance(b, 120, null, now).return.outstandingStep).toBe(
      'RETURN_COMPLETION_REQUIRED',
    );
    b.operationalHold = true;
    expect(workflowCompliance(b, 120, null, now).return.outstandingStep).toBe(
      'RETURN_DISPUTE_OR_HOLD',
    );
  });
});
