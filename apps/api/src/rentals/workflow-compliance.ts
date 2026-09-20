import { HANDOVER_WORKFLOW_VERSION_B4 } from '@carrental/api-contracts';

interface WorkflowBooking {
  status: string;
  handoverWorkflowVersion: number | null;
  rentalStart: Date;
  rentalEnd: Date;
  pickupWindowEnd: Date | null;
  actualPickupAt: Date | null;
  actualReturnAt: Date | null;
  operationalHold: boolean;
  vehicle?: { operationalStatus?: string };
  rentalIncidents?: { blocksCompletion: boolean; status: string }[];
  disputes?: { blocksCompletion: boolean; status: string }[];
  fulfillmentSnapshot: { startMethod: string; endMethod: string } | null;
  handoverTravelEvents: { phase: string; status: string }[];
  handoverEvidenceWaivers?: { phase: string }[];
  pickupHandoverResponse?: { decision: string } | null;
  inspections: {
    type: string;
    confirmations: {
      role: string;
      decision: string;
      discrepancyResponses: {
        resolutionReview: {
          decision: string;
          operationsResolution: { outcome: string } | null;
        } | null;
      }[];
    }[];
  }[];
}

/** Presentation only: financial eligibility is independently enforced in PostgreSQL. */
export function workflowCompliance(
  booking: WorkflowBooking,
  returnGraceMinutes: number,
  payoutBlocker: string | null,
  now = new Date(),
) {
  const pickup = booking.inspections.find((inspection) => inspection.type === 'PICKUP');
  const returned = booking.inspections.find((inspection) => inspection.type === 'RETURN');
  const startWaived =
    booking.handoverWorkflowVersion === HANDOVER_WORKFLOW_VERSION_B4 &&
    booking.handoverEvidenceWaivers?.some((w) => w.phase === 'START');
  const returnWaived =
    booking.handoverWorkflowVersion === HANDOVER_WORKFLOW_VERSION_B4 &&
    booking.handoverEvidenceWaivers?.some((w) => w.phase === 'RETURN');
  const renter = pickup?.confirmations.find((confirmation) => confirmation.role === 'RENTER');
  const review = renter?.discrepancyResponses.at(-1)?.resolutionReview;
  const resolutionAllows =
    review?.decision === 'ACCEPTED' ||
    (review?.decision === 'STILL_DISAGREES' &&
      review.operationsResolution?.outcome === 'HANDOVER_MAY_RESUME');
  const startRecorded = Boolean(booking.actualPickupAt);
  const returnRecorded = Boolean(
    booking.actualReturnAt && ['RETURNED', 'COMPLETED'].includes(booking.status),
  );
  const travelArrived = (phase: string) =>
    booking.handoverTravelEvents.some(
      (event) => event.phase === phase && event.status === 'ARRIVED',
    );
  const held =
    booking.operationalHold ||
    booking.vehicle?.operationalStatus === 'MAINTENANCE' ||
    booking.rentalIncidents?.some(
      (incident) => incident.blocksCompletion && ['OPEN', 'ACKNOWLEDGED'].includes(incident.status),
    ) ||
    booking.disputes?.some(
      (dispute) =>
        dispute.blocksCompletion &&
        ['OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW'].includes(dispute.status),
    );
  const unresolved = renter?.decision === 'DISAGREED' && !resolutionAllows;
  const startStep = startRecorded
    ? null
    : held
      ? 'OPERATIONS_HOLD'
      : unresolved
        ? 'DISCREPANCY_RESOLUTION_REQUIRED'
        : booking.fulfillmentSnapshot?.startMethod === 'OWNER_DELIVERY' && !travelArrived('START')
          ? 'OWNER_DELIVERY_ARRIVAL_REQUIRED'
          : startWaived
            ? booking.pickupHandoverResponse?.decision === 'CONFIRMED'
              ? 'PICKUP_VERIFICATION_REQUIRED'
              : booking.pickupHandoverResponse
                ? 'OPERATIONS_HOLD'
                : 'RENTER_HANDOVER_TIME_CONFIRMATION_REQUIRED'
            : !pickup
              ? 'OWNER_INSPECTION_REQUIRED'
              : !renter
                ? 'RENTER_REVIEW_REQUIRED'
                : renter.decision === 'DISAGREED' && !resolutionAllows
                  ? 'DISCREPANCY_RESOLUTION_REQUIRED'
                  : 'PICKUP_VERIFICATION_REQUIRED';
  const returnStep = returnRecorded
    ? null
    : held
      ? 'RETURN_DISPUTE_OR_HOLD'
      : booking.status === 'ACTIVE'
        ? 'RENTER_RETURN_START_REQUIRED'
        : booking.fulfillmentSnapshot?.endMethod === 'OWNER_COLLECTION' && !travelArrived('RETURN')
          ? 'OWNER_COLLECTION_ARRIVAL_REQUIRED'
          : returnWaived
            ? 'OWNER_RETURN_RECEIPT_REQUIRED'
            : !returned
              ? 'RENTER_RETURN_INSPECTION_REQUIRED'
              : !returned.confirmations.some((confirmation) => confirmation.role === 'OWNER')
                ? 'OWNER_RETURN_REVIEW_REQUIRED'
                : 'RETURN_COMPLETION_REQUIRED';
  const returnBoundary = new Date(booking.rentalEnd.getTime() + returnGraceMinutes * 60_000);
  return {
    evaluatedAt: now,
    workflow:
      booking.handoverWorkflowVersion === null
        ? 'LEGACY'
        : booking.handoverWorkflowVersion === HANDOVER_WORKFLOW_VERSION_B4
          ? 'B4'
          : 'UNSUPPORTED',
    start: {
      overdue:
        ['CONFIRMED', 'READY_FOR_PICKUP'].includes(booking.status) &&
        !startRecorded &&
        Boolean(booking.pickupWindowEnd && now > booking.pickupWindowEnd),
      scheduledAt: booking.rentalStart,
      graceBoundary: booking.pickupWindowEnd,
      custodyRecorded: startRecorded,
      evidenceOutcome: startWaived ? 'WAIVED' : startRecorded && pickup ? 'VERIFIED' : 'PENDING',
      outstandingStep: startStep,
    },
    return: {
      overdue:
        ['ACTIVE', 'RETURN_PENDING'].includes(booking.status) &&
        !returnRecorded &&
        now > returnBoundary,
      scheduledAt: booking.rentalEnd,
      graceBoundary: returnBoundary,
      custodyRecorded: returnRecorded,
      evidenceOutcome: returnWaived
        ? 'WAIVED'
        : returnRecorded && returned
          ? 'VERIFIED'
          : 'PENDING',
      outstandingStep: returnStep,
    },
    payoutBlocker,
  };
}
