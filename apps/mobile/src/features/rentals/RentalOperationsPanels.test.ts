import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'RentalOperationsPanels.tsx'),
  'utf8',
);
const photoSlotSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../ui/SecureCameraPhotoSlot.tsx'),
  'utf8',
);
const ownerRentalsSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'OwnerRentalsScreen.tsx'),
  'utf8',
);
const bookingsSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../bookings/MyBookingsScreen.tsx'),
  'utf8',
);

describe('inspection correction mobile synchronization', () => {
  it('uses explicit consequential acknowledgement, independent waiver states and receipt confirmation', () => {
    for (const copy of [
      'Complete without inspection',
      'Go back and complete inspection',
      'Continue without inspection',
      'Pickup verification required',
      'Waiting for the owner to confirm vehicle receipt.',
      'Return completed without inspection evidence',
    ])
      expect(source).toContain(copy);
    expect(source).toContain('acknowledged: true');
    expect(source).toContain('HANDOVER_EVIDENCE_WAIVER_ACKNOWLEDGEMENT_VERSION');
    expect(source).toContain('vehicleReceived: true');
    expect(source).toContain('accessibilityRole="button"');
    expect(source).not.toContain('CarShare cannot help');
  });
  it('clamps the active-rental scroll offset when dynamic content becomes shorter', () => {
    expect(ownerRentalsSource).toContain('<NestedScreen\n      constrainOverscroll');
    expect(ownerRentalsSource).toContain('onContentSizeChange={(_width, height) =>');
    expect(ownerRentalsSource).toContain('height - scrollViewportHeight.current');
    expect(ownerRentalsSource).toContain('scrollTo({ animated: false, y: maximumOffset })');
    expect(ownerRentalsSource).toContain('refetchInterval: selected ? 5_000 : false');
    expect(ownerRentalsSource).toContain('void rentals.refetch()');
  });
  it('sends the authoritative proposal field and prevents another pending prompt', () => {
    expect(source).toContain('proposedOdometerMeters');
    expect(source).not.toContain('correctedOdometerMeters');
    expect(source).toContain('Correction requested · Pending admin review');
  });
  it('polls open rental details and displays approved/rejected outcomes', () => {
    expect(source).toContain("['READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING']");
    expect(source).toContain('✓ Correction approved');
    expect(source).toContain('Correction rejected');
    expect(source).toContain('Pickup inspection corrected');
  });
  it('previews captured and persisted evidence while keeping normal handovers asymmetric', () => {
    expect(source.indexOf('{pickupOverdue && (')).toBeLessThan(
      source.indexOf("detail.fulfillment.startMethod === 'OWNER_DELIVERY'"),
    );
    expect(source.indexOf('Handover overdue')).toBeLessThan(
      source.indexOf('Your car is being delivered'),
    );
    expect(source).toContain('label="Complete handover"');
    expect(source).toContain('detail.workflowCompliance?.start.overdue');
    expect(source).toContain('pendingAttachment.current');
    expect(source).toContain('label="Retry"');
    expect(source.lastIndexOf('{pickupOverdue && (')).toBeLessThan(
      source.lastIndexOf("detail.fulfillment.startMethod === 'OWNER_DELIVERY'"),
    );
    expect(source).toContain('SecureCameraPhotoSlot');
    expect(photoSlotSource).toContain('Captured and securely uploaded');
    expect(photoSlotSource).toContain("hasPreview ? 'Retake' : (captureLabel ?? 'Open camera')");
    expect(source).toContain("mode: 'append' | 'replace'");
    expect(source.match(/<SecureCameraPhotoSlot/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('/pickup/inspection/draft/media');
    expect(source).toContain('owner-pickup-inspection-draft');
    expect(source).toContain('CapturedPreviews');
    expect(source).toContain('AuthorizedInspectionImage');
    expect(source).toContain('/access-grants');
    expect(source).toContain('Pickup inspection · Submitted by owner');
    expect(source).toContain('Return evidence · Submitted by renter');
    expect(source).toContain('View inspection photos (');
    expect(
      source.match(/accessibilityLabel="Close photo gallery"/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(source.match(/hitSlop={spacing.md}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source.match(/accessible={false}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('inspection.media.map(({ fileAsset, perspective }) => ({');
    expect(source).toContain('title: domainLabel(perspective)');
    expect(source).toContain('<Text style={styles.conditionGalleryCount}>{item.title}</Text>');
    expect(source).not.toContain('Submit receipt inspection');
    expect(source).toContain('Confirm condition');
    expect(source).toContain('Report discrepancy');
    expect(source).toContain('/pickup/inspection/review');
    expect(source).toContain('conditionDisclosureState');
    expect(source).toContain('No known existing issues');
    expect(source).toContain('MECHANICAL_OR_OPERATIONAL');
    expect(source).toContain('WINDSHIELD');
    expect(source).toContain('SAFETY_CRITICAL');
    expect(source).toContain('Handover paused');
    expect(source).toContain('/pickup/discrepancy/respond');
    expect(source).toContain('/pickup/discrepancy/review');
    expect(source).toContain('Accept resolution');
    expect(source).toContain('Still disagree');
    expect(source).toContain('Resolution history');
    expect(source).toContain('Continue resolving');
    expect(source).toContain('onPress={onContinueResolving}');
    expect(bookingsSource).toContain('onContinueResolving: () => onMessage');
    expect(source).toContain('Contact CarShare support');
    expect(source).toContain('onPress={submitDiscrepancySupport}');
    expect(source).toContain('Enter at least 3 characters before contacting CarShare support.');
    expect(source).toContain('style={styles.inlineError}');
    expect(source).toContain('action.isError && !ownerDiscrepancyResponseError');
    expect(source).toContain('action.reset()');
    expect(source).toContain(
      "pickupReview.discrepancyResponse?.resolutionReview?.decision !== 'ACCEPTED'",
    );
    expect(source).toContain("if (operation === 'pickup-disagree') setPickupDiscrepancy('')");
    expect(source).toContain("setResolutionReason('')");
    expect(source).toContain("if (operation.startsWith('discrepancy-')) {");
    expect(source).toContain("setOwnerDiscrepancyResponse('')");
    expect(source).toContain('/handover-cancellation/quote');
    expect(source).toContain('/handover-cancellation');
    expect(source).toContain('style={styles.cancellationForm}');
    expect(source).toContain('style={styles.cancellationSummary}');
    expect(source).toContain('styles.cancellationDangerButton');
    expect(source).toContain('scrollToCancellationFormAfterLayout.current = true');
    expect(source).toContain('scrollToCancellationSummaryAfterLayout.current = true');
    expect(source).toContain('panelOffsetY.current + nativeEvent.layout.y - spacing.md');
    expect(source).toContain('cancellationFormOffsetY.current +');
    expect(source).toContain('resolutionReasonRef.current.measureInWindow');
    expect(source).toContain('scrollResolutionFormBy?.(overlap)');
    expect(source).toContain('onCancellationCompleted?.()');
    expect(bookingsSource).toContain('scrollRef={scrollRef}');
    expect(bookingsSource).toContain('scrollToCancellationForm={(y) =>');
    expect(bookingsSource).toContain('scrollResolutionFormBy={(delta) =>');
    expect(bookingsSource).toContain('scrollToCancelledSummaryAfterLayout.current = true');
    expect(bookingsSource).toContain('nativeEvent.layout.y - spacing.md');
    expect(source).toContain('CarShare commission retained');
    expect(source).toContain('Booking cancelled before handover');
    expect(source).not.toContain('label="Contact renter"');
    expect(source).toContain('New findings (');
    expect(source).toContain('showConditionIssueForm');
    expect(source).toContain('label="+ Add another issue"');
    expect(source).toContain('scrollToConditionFormAfterLayout');
    expect(source).toContain('conditionDescriptionRef.current?.isFocused()');
    expect(source).toContain('ownerDiscrepancyResponseRef.current?.isFocused()');
    expect(source).toContain('focusedInput.measureInWindow');
    expect(source).toContain('scrollConditionFormBy?.(overlap)');
    expect(source).toContain('SearchableReferenceSelector');
    expect(source).toContain('captureLabel="Add photo"');
    expect(source).toContain("perspective: 'ADDITIONAL'");
    expect(source).toContain('conditionEvidence.map');
    expect(source).toContain('compactRemoveOverlay');
    expect(source).toContain('conditionEvidence.length < 10');
    expect(source).toContain('Save issue');
    expect(source).toContain('Save changes');
    expect(source).toContain("'Remove issue?'");
    expect(source).toContain('conditionClassificationExplanation');
    expect(source).toContain('Submit inspection');
    expect(source).toContain('Keyboard.dismiss()');
    expect(source).toContain('HANDOVER_MAY_RESUME');
    expect(source).toContain('Further support review is required');
    expect(source).toContain("category === 'RENTER_NO_SHOW'");
    expect(source).toContain('✓ Renter no-show reported');
    expect(source).toContain("action.variables === 'renter-no-show'");
    expect(source).toContain('Get pickup code');
    expect(source).toContain('scrollToPickupCodeAfterLayout.current = true');
    expect(source).toContain('panelOffsetY.current + nativeEvent.layout.y - spacing.md');
    expect(bookingsSource).toContain('scrollToPickupCode={(y) =>');
    expect(source).toContain('/handover/travel');
    expect(source).toContain('Your car is being delivered');
    expect(source).toContain('Owner collection');
    expect(source).toContain("detail.handoverTravel.startStatus === 'ARRIVED'");
    expect(source).toContain("detail.handoverTravel.returnStatus === 'ARRIVED'");
    expect(source).toContain('needsInspection && !handoverStarted && pickupHandoverReady');
    expect(source).toContain('!returned &&');
    expect(source).toContain('!returnWaived &&');
    expect(source).toContain('const returnRecoveryReady = returnHandoverReady || returnOverdue;');
    expect(source).toContain('!returnOverdue &&');
    expect(source).toContain("'OWNER_COLLECTION_ARRIVAL_REQUIRED'");
    expect(source).toContain('ownerInitiatedReturn');
    expect(source).toContain('Vehicle already received?');
    expect(source).toContain('CarShare will have limited evidence available');
    expect(source).toContain('!returnInspectionStarted && (');
    expect(source).toContain('returnInspectionStarted && (');
    expect(source).toContain('label="Start return handover"');
    expect(source).toContain('{!returnOverdue && (\n            <Action label="Start return"');
    expect(source.match(/returnRecoveryReady &&\n\s*!returnOverdue &&/g)).toHaveLength(2);
    expect(source).toContain(
      'Waiting for the owner to report the overdue Return without inspection.',
    );
    expect(source).toContain('const bothPhasesOverdue = pickupOverdue && returnOverdue;');
    expect(source).toContain(
      'const returnOverdue = returnWorkflowOverdue || returnRecoveryOverdue;',
    );
    expect(source).toContain("? 'Pickup and Return overdue'");
    expect(source).toContain(
      "detail.pickupWindowStart && detail.status === 'READY_FOR_PICKUP' && !pickupOverdue",
    );
    expect(source).toContain('!startWaived && !pickupOverdue && (');
    expect(source).toContain('Pickup and Return are overdue');
    expect(source).toContain('Waiting for the owner to report both handovers without inspections.');
    expect(source).toContain('have 24 hours to confirm or disagree');
    expect(source).toContain('!returnOverdue &&');
    expect(source).toContain('!pickupOverdue &&');
    expect(source).not.toContain('label="Complete return inspection"');
    expect(source).not.toContain('scrollToReturnInspectionAfterLayout');
    expect(source).toContain('Waiting for the owner to arrive');
    expect(source).toContain("actionsEnabled={detail.status === 'RETURN_PENDING'}");
    expect(source).toContain('actionsEnabled && next');
    expect(source).not.toContain('/owner/bookings/${reference}/rental/return/inspection');
  });

  it('offers the owner one recovery action for exactly the overdue phases', () => {
    expect(source).toContain("const overdueRecoveryScope: 'START' | 'RETURN' | 'BOTH' | null =");
    expect(source).toContain('pickupOverdue && returnRecoveryOverdue');
    expect(source).toContain("? 'BOTH'");
    expect(source).toContain('{overdueRecoveryScope && !detail.overdueHandoverRecovery && (');
    expect(source).toContain('<OwnerOverdueRecoveryAction');
    expect(source).toContain('scope={overdueRecoveryScope}');
    expect(source).toContain('{pickupOverdue && !startWaived && !overdueRecoveryScope && (');
    expect(source).toContain(
      "detail.fulfillment.startMethod === 'OWNER_DELIVERY' &&\n        !pickupOverdue &&",
    );
    expect(
      source.match(
        /detail\.fulfillment\.startMethod === 'OWNER_DELIVERY' &&\n\s*!pickupOverdue &&/g,
      ),
    ).toHaveLength(2);
    expect(source).toContain(
      'needsInspection && !handoverStarted && !pickupHandoverReady && !pickupOverdue',
    );
    expect(source).toContain('Waiting for renter response');
    expect(source).toContain('No response accepts the report automatically.');
    expect(source).toContain('Complete booking without inspections');
    expect(source).toContain("? 'Pickup and Return overdue'");
    expect(source).toContain("? 'Pickup overdue'");
    expect(source).toContain("? 'Return overdue'");
    expect(source).toContain('Return scheduled: {dateTimeLabel(detail.rentalEnd)}');
    expect(source).toContain("detail.status === 'ACTIVE' && !returnRecoveryOverdue && (");
    expect(source).toContain(
      "detail.workflowCompliance?.return.evidenceOutcome !== 'WAIVED' &&\n        !overdueRecoveryScope",
    );
    expect(source).toContain(
      'detail.workflowCompliance?.return.overdue && !returnWaived && !overdueRecoveryScope',
    );
    expect(source).toContain(
      "{scope !== 'START' && <Text style={styles.cardTitle}>Your payout remains pending</Text>}",
    );
    expect(source).toContain('Vehicle given to renter');
    expect(source).toContain('Vehicle returned to owner');
    expect(source).toContain('The renter will be notified and has 24 hours to disagree.');
    expect(source).toContain('both reported handover times are accepted automatically.');
    expect(source).toContain('the reported pickup time is accepted automatically.');
    expect(source).toContain('the reported Return time is accepted automatically.');
    expect(source).toContain('Complete without inspections?');
    expect(source).toContain("? 'Report handover'");
    expect(source).toContain("? 'Report return'");
    expect(source).toContain(": 'Report both handovers'");
    expect(source).not.toContain('Notify renter and start 24-hour review');
    expect(source).toContain('/rental/overdue-handover-recovery');
    expect(source).toContain("label={`Confirm ${recovery.scope === 'START'");
    expect(source).toContain('Owner reported Return without inspection');
    expect(source).toContain('report awaiting your response`');
    expect(source).toContain("? 'Pickup completed'");
    expect(source).not.toContain('The reported times are correct');
    expect(source).toContain('Send disagreement to Operations');
    expect(source).toContain('CarShare will have limited evidence to help');
    expect(source).toContain('{!startWaived && (');
    expect(source).toContain('Pickup odometer: {odometerLabel(pickup?.odometerMeters)}');
    expect(bookingsSource).toContain(
      'operational && now >= new Date(booking.pickupWindow?.opensAt ?? booking.rentalStart).getTime();',
    );
    expect(bookingsSource).toContain('{pickupHasBegun && rentalOperations}');
    expect(bookingsSource).toContain('{!pickupHasBegun && rentalOperations}');
    expect(bookingsSource).toContain('label="View booking details"');
    expect(bookingsSource).toContain("'OVERDUE_HANDOVER_RECOVERY_RETURN_REPORTED'");
    expect(bookingsSource).toContain("'Owner reported Return without inspection'");
    expect(bookingsSource).toContain('`Action required: Confirm ${scopeLabel}`');
    expect(bookingsSource).toContain('Response due: {dateTimeLabel(recovery.responseDeadlineAt)}');
    expect(bookingsSource).toContain('handover reports need your response');
    expect(bookingsSource).toContain('Under Operations review');
    expect(bookingsSource).toContain('label="Review handover"');
    expect(source).toContain('scrollToRecoveryResponse?.(');
    expect(bookingsSource).toContain('presentationStyle="pageSheet"');
    expect(bookingsSource).toContain('visible={bookingDetailsOpen}');
    expect(bookingsSource).toContain('accessibilityLabel="Close booking details"');
    expect(bookingsSource).toContain('{!pickupHasBegun && (');
  });

  it('preloads active vehicle issues and snapshots newly discovered issues once', () => {
    expect(source).toContain('Known issues from your vehicle');
    expect(source).toContain('knownIssueId: issue.id');
    expect(source).toContain('persistAsKnownIssue: editingConditionIssue === null');
    expect(source).toContain('Active known issues must be addressed');
    expect(source).not.toContain('/known-issues/${issue.knownIssueId}/resolution');
    expect(source).not.toContain("label={issue.knownIssueId ? 'Mark as resolved'");
    expect(source).toContain('View supporting photos (');
    expect(source).toContain('pagingEnabled');
    expect(source).toContain('Known issue supporting photo');
    expect(source).toContain(
      'title: `${domainLabel(issue.category)} · ${domainLabel(issue.vehicleArea)}`',
    );
    expect(source).toContain('setIssueGallery(evidenceItems)');
    expect(source).toContain('inspectionMedia.fileAsset.id');
    expect(source).toContain('knownIssueEvidenceFileAssetIds');
    expect(source).toContain('evidenceFileAssetIds: [] as readonly string[]');
    expect(source).toContain('evidenceFileAssetIds: conditionEvidenceIds');
    expect(source).toContain('conditionIssues.map(conditionIssuePayload)');
    expect(source).toContain('function conditionIssuePayload(issue: ConditionIssueDraft)');
    expect(source).toContain('Please enter at least 3 characters.');
  });
});
