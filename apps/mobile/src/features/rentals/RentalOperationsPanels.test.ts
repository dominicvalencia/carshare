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
    expect(source.indexOf('Handover confirmation overdue')).toBeLessThan(
      source.indexOf('Your car is being delivered'),
    );
    expect(source).toContain('label="Report handover issue"');
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
    expect(source).toContain('!returned && returnHandoverReady');
    expect(source).toContain('Waiting for the owner to arrive');
    expect(source).toContain("actionsEnabled={detail.status === 'RETURN_PENDING'}");
    expect(source).toContain('actionsEnabled && next');
    expect(source).not.toContain('/owner/bookings/${reference}/rental/return/inspection');
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
