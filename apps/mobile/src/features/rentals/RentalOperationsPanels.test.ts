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
    expect(ownerRentalsSource).toContain(
      '<NestedScreen\n      compactNestedHeader\n      constrainOverscroll',
    );
    expect(ownerRentalsSource).toContain('contentTopPadding={spacing.sm}');
    expect(ownerRentalsSource).toContain('backLabel="Back"');
    expect(ownerRentalsSource).not.toContain("selected ? 'All rentals' : 'Back'");
    expect(ownerRentalsSource).toContain('onContentSizeChange={(_width, height) =>');
    expect(ownerRentalsSource).toContain('height - scrollViewportHeight.current');
    expect(ownerRentalsSource).toContain('scrollTo({ animated: false, y: maximumOffset })');
    expect(ownerRentalsSource).toContain('refetchInterval: selected ? 5_000 : false');
    expect(ownerRentalsSource).toContain('void rentals.refetch()');
  });
  it('prioritizes a compact rental summary, next action, secondary actions, and danger zone', () => {
    const ownerPanel = source.slice(
      source.indexOf('export function OwnerRentalPanel'),
      source.indexOf('function RentalScheduleRow'),
    );
    expect(source).toContain('style={[styles.panel, styles.ownerPanel]}');
    expect(source).toContain('ownerPanel: { borderTopWidth: 0, marginTop: 0, paddingTop: 0 }');
    expect(source).toContain('style={styles.rentalSummaryCard}');
    expect(source).toContain('<StatusBadge label={statusLabel} />');
    expect(source.match(/label="Dates & time"/g)).toHaveLength(2);
    expect(
      source.match(/rentalTripSummary\(detail\.rentalStart, detail\.rentalEnd\)/g),
    ).toHaveLength(2);
    expect(ownerPanel).toContain('label="Dates & time"');
    expect(ownerPanel).toContain('rentalTripSummary(detail.rentalStart, detail.rentalEnd)');
    expect(ownerPanel).not.toContain('<RentalScheduleRow label="Pickup"');
    expect(ownerPanel).not.toContain('<RentalScheduleRow label="Return"');
    expect(source).toContain('label="Handover available"');
    expect(source).toContain('Complete pickup inspection');
    expect(source).toContain('Document the vehicle before handing it to the renter.');
    expect(source).toContain('label="Start handover"');
    expect(source).not.toContain('Complete the handover to protect your payout');
    expect(source).toContain('Complete the recorded handover to keep payout eligibility on track.');
    expect(source).toContain('<Text style={styles.sectionTitle}>Rental actions</Text>');
    expect(source).toContain('label="Report incident"');
    expect(source).toContain('label="Message"');
    expect(ownerRentalsSource).toContain('<Text style={styles.dangerEyebrow}>Danger zone</Text>');
    expect(ownerRentalsSource).toContain('Only cancel when necessary.');
    expect(ownerRentalsSource).toContain('onPress={() => setCancellationOpen(true)}');
  });
  it('sends the authoritative proposal field and prevents another pending prompt', () => {
    expect(source).toContain('proposedOdometerMeters');
    expect(source).not.toContain('correctedOdometerMeters');
    expect(source).toContain('Correction requested · Pending admin review');
    expect(source).toContain('Waiting for administrator review');
    expect(source).toContain('Vehicle receipt cannot be');
    expect(source).toContain("latestCorrection?.status === 'PENDING_REVIEW'");
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
    expect(source).toContain('<PickupInspectionSummary inspection={pickup} />');
    expect(source).toContain('Review pickup condition');
    expect(source).toContain('<ReturnInspectionEvidence inspection={returned} />');
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
    expect(source).toContain('<Text style={styles.cardTitle}>New issues</Text>');
    expect(source).toContain('showConditionIssueForm');
    expect(source).toContain('label="Add another"');
    expect(source).toContain('conditionSheetAnimatedStyle');
    expect(source).toContain('automaticallyAdjustKeyboardInsets');
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
    expect(source).toContain("operation === 'claim' && !canCreateClaim");
    expect(source).toContain(
      "['incident', 'renter-no-show'].includes(operation) && !canReportIncident",
    );
    expect(source).toContain('return apiClient.request(`${rentalEndpoint}/incidents`');
    expect(source).not.toContain(
      "['claim', 'incident', 'correction', 'renter-no-show'].includes(operation)",
    );
    expect(source).toContain("operation === 'correction' && !canInspect");
    expect(source).toContain("operation.startsWith('discrepancy-') && !canHandover");
    expect(source).toContain('`${rentalEndpoint}/pickup/discrepancy/respond`');
    expect(source).toContain('`${rentalEndpoint}/inspections/${pickup.id}/corrections`');
    expect(source).toContain('Get pickup code');
    expect(source).toContain('scrollToPickupCodeAfterLayout.current = true');
    expect(source).toContain('panelOffsetY.current + nativeEvent.layout.y - spacing.md');
    expect(bookingsSource).toContain('scrollToPickupCode={(y) =>');
    expect(source).toContain('/handover/travel');
    expect(source).toContain('Your car is being delivered');
    expect(source).toContain("return 'Your vehicle is on the way.';");
    expect(source).toContain('label="Delivery address"');
    expect(source).toContain('label="Scheduled handover"');
    expect(source).toContain('<StatusBadge label={travelLabel(status)} />');
    expect(source).toContain("upcomingSection === 'travel'");
    expect(source).toContain('securityDepositPending ||');
    expect(source).toContain('Owner collection');
    expect(source).toContain("detail.handoverTravel.startStatus === 'ARRIVED'");
    expect(source).toContain("detail.handoverTravel.returnStatus === 'ARRIVED'");
    expect(source).toContain('pickupHandoverReady &&\n        !pickupOverdue &&');
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
    expect(source).toContain("detail.status === 'ACTIVE' && !returnOverdue ? (");
    expect(source).toContain('<Action label="Start return"');
    expect(source.match(/returnRecoveryReady &&\n\s*!returnOverdue &&/g)).toHaveLength(2);
    expect(source).toContain(
      'Waiting for the owner to report the overdue Return without inspection.',
    );
    expect(source).toContain('const bothPhasesOverdue = pickupRecoveryRequired && returnOverdue;');
    expect(source).toContain(
      'const returnOverdue = returnWorkflowOverdue || returnRecoveryOverdue;',
    );
    expect(source).toContain("? 'Pickup and Return overdue'");
    expect(source).toContain(
      "detail.pickupWindowStart && detail.status === 'READY_FOR_PICKUP' && !pickupOverdue",
    );
    expect(source).toContain(
      "if (state.startWaived) return 'Waiting for the owner to report the pickup handover.';",
    );
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

  it('maps delegated overdue recovery failures to safe actionable messages', () => {
    expect(source).toContain('function overdueRecoveryErrorMessage(');
    expect(source).toContain('You no longer have access to complete this rental operation.');
    expect(source).toContain('Return time must be after the handover time');
    expect(source).toContain('This rental can no longer be recovered from its current state.');
    expect(source).toContain('This rental changed. Refresh and try again.');
    expect(source).toContain('overdueRecoveryErrorMessage(action.error, scope');
    expect(source).toContain('action.reset();');
  });

  it('keeps the accepted-booking delivery and next-step cards compact and renter-facing', () => {
    const deliveryCard = source.slice(
      source.indexOf('function UpcomingDeliveryStatus'),
      source.indexOf('function upcomingNextStepMessage'),
    );
    const nextStep = source.slice(
      source.indexOf('function upcomingNextStepMessage'),
      source.indexOf('function locationLabel'),
    );

    expect(deliveryCard).toContain('Delivery address');
    expect(deliveryCard).toContain('Scheduled handover');
    expect(deliveryCard).toContain('dateTimeLabel(detail.rentalStart)');
    expect(deliveryCard).toContain('<StatusBadge label={travelLabel(status)} />');
    expect(deliveryCard).not.toContain('Progress:');
    expect(deliveryCard).not.toContain('Contractual address:');
    expect(nextStep).toContain('Be ready at the delivery location by ${timeLabel');
    expect(nextStep).toContain('Your vehicle is on the way.');
  });

  it('presents owner collection as a compact status card with a public locality', () => {
    const card = source.slice(
      source.indexOf('function OwnerCollectionStatus'),
      source.indexOf('function UpcomingDeliveryStatus'),
    );
    const formatter = source.slice(
      source.indexOf('function collectionLocationLabel'),
      source.indexOf('function OwnerCollectionStatus'),
    );

    expect(source).toContain('<OwnerCollectionStatus detail={detail} />');
    expect(card).toContain('Owner collection');
    expect(card).toContain('<StatusBadge label={travelLabel(status)} />');
    expect(card).toContain('label="Collection location"');
    expect(card).toContain('collectionLocationLabel(detail.fulfillment.endLocation)');
    expect(card).toContain('label="Scheduled collection"');
    expect(card).toContain('dateTimeLabel(detail.rentalEnd)');
    expect(card).toContain('styles.ownerCollectionCard');
    expect(card).not.toContain('Progress:');
    expect(card).not.toContain('Contractual address:');
    expect(formatter).toContain('addressParts.slice(cityIndex, cityIndex + 2)');
    expect(formatter).toContain('[location.city, location.province]');
  });

  it('presents the authoritative pickup evidence as a compact operational checklist', () => {
    for (const perspective of [
      'FRONT',
      'REAR',
      'DRIVER_SIDE',
      'PASSENGER_SIDE',
      'INTERIOR',
      'DASHBOARD',
      'ODOMETER',
      'FUEL_OR_BATTERY_DISPLAY',
    ])
      expect(source).toContain(`'${perspective}'`);
    expect(source).toContain('Vehicle readings');
    expect(source).toContain('Exterior photos');
    expect(source).toContain('Interior photos');
    expect(source).toContain('Pickup notes · Optional');
    expect(source).toContain('required photos added');
    expect(source).toContain("detail.vehicle.powertrain !== 'BATTERY_ELECTRIC'");
    expect(source).toContain("['BATTERY_ELECTRIC', 'PLUG_IN_HYBRID']");
    expect(source).toContain('captureLabel="Capture"');
    expect(source).toContain('checklist');
    expect(photoSlotSource).toContain("{hasPreview ? 'Added' : 'Not added'}");
    expect(photoSlotSource).toContain("hasPreview ? 'Retake' : (captureLabel ?? 'Capture')");
    expect(source).toContain('Ready to submit');
    expect(source).toContain('All required pickup evidence has been added.');
    expect(source).toContain('disabled={!inspectionReady');
  });

  it('presents renter return evidence with the shared compact inspection checklist', () => {
    expect(source).toContain('<Text accessibilityRole="header" style={styles.inspectionTitle}>');
    expect(source).toContain('Return inspection');
    expect(source).toContain('Document the vehicle condition before returning it.');
    expect(source).toContain(
      '{completedRequired(files)} of {perspectives.length} required photos added',
    );
    expect(source).toContain('const returnInspectionReady =');
    expect(source).toContain('hasRequiredPhotos(files) && Boolean(odometer)');
    expect(source).toContain('{readingPerspectives.map(renderReturnPhoto)}');
    expect(source).toContain('{exteriorPerspectives.map(renderReturnPhoto)}');
    expect(source).toContain('{interiorPerspectives.map(renderReturnPhoto)}');
    expect(source).toContain("{renderReturnPhoto('ADDITIONAL')}");
    expect(source).toContain('captureLabel="Capture"');
    expect(source).toContain('checklist');
    expect(source).toContain("capture.mutate({ mode: 'replace', perspective })");
    expect(source).toContain("capture.mutate({ mode: 'append', perspective })");
    expect(photoSlotSource).toContain("hasPreview ? 'Added' : 'Not added'");
    expect(photoSlotSource).toContain("hasPreview ? 'Retake' : (captureLabel ?? 'Capture')");
    expect(source).toContain("detail.vehicle.powertrain !== 'BATTERY_ELECTRIC'");
    expect(source).toContain("['BATTERY_ELECTRIC', 'PLUG_IN_HYBRID']");
    expect(source).toContain('Return notes · Optional');
    expect(source).toContain('Add anything the owner should know about the vehicle condition.');
    expect(source).toContain('Ready to return');
    expect(source).toContain('All required return evidence has been added.');
    expect(source).toContain("label={action.isPending ? 'Confirming…' : 'Confirm vehicle return'}");
    expect(source).toContain('disabled={!returnInspectionReady || action.isPending}');
    expect(source).toContain('odometerMeters: String(Math.round(Number(odometer) * 1000))');
    expect(source).toContain('media: inspectionMedia(files)');
    expect(source).toContain("notes.trim() || 'Return inspection submitted by the renter");
  });

  it('uses an accessible single-choice selector for existing vehicle condition', () => {
    expect(source).toContain('accessibilityLabel="Existing vehicle condition"');
    expect(source).toContain('accessibilityRole="radiogroup"');
    expect(source.match(/<ConditionDisclosureOption/g)).toHaveLength(2);
    expect(source).toContain('label="No known issues"');
    expect(source).toContain('label="Report issues"');
    expect(source).toContain("selected={conditionDisclosureState === 'NO_KNOWN_ISSUES'}");
    expect(source).toContain("selected={conditionDisclosureState === 'ISSUES_REPORTED'}");
    expect(source).toContain('accessibilityRole="radio"');
    expect(source).toContain('accessibilityState={{ checked: selected, selected }}');
    expect(source).toContain('name="checkmark"');
    const conditionOption = source.slice(
      source.indexOf('function ConditionDisclosureOption'),
      source.indexOf('function overdueTimestampError'),
    );
    expect(conditionOption.indexOf('name="checkmark"')).toBeLessThan(
      conditionOption.indexOf('styles.conditionChoiceText'),
    );
    expect(source).not.toContain("name={selected ? 'checkmark-circle' : 'ellipse-outline'}");
    expect(source).toContain('selected && styles.conditionChoiceSelected');
    expect(source).toContain('conditionChoiceGroup: {\n    backgroundColor: colors.muted');
    expect(source).toContain('conditionChoiceSelected: { backgroundColor: colors.primary }');
    expect(source).toContain("conditionDisclosureState === 'ISSUES_REPORTED' ? (");
    expect(source).toContain("conditionDisclosureState !== 'NOT_REVIEWED'");
    expect(source).toContain("conditionDisclosureState === 'ISSUES_REPORTED'");
  });

  it('edits reported condition issues in an adaptive sheet without changing payload semantics', () => {
    expect(source).toContain('visible={showConditionIssueForm}');
    expect(source).toContain('style={[styles.conditionSheet, conditionSheetAnimatedStyle]}');
    expect(source).toContain('onRequestClose={closeConditionIssueSheet}');
    expect(source).toContain('<BackControl label="Back" onPress={closeConditionIssueSheet} />');
    expect(source).toContain("? 'Report existing issue'");
    expect(source).toContain('label="Issue type"');
    expect(source).toContain('label="Location"');
    expect(source).toContain('label="Severity"');
    expect(source.match(/sheetDismissLabel="Back"/g)).toHaveLength(4);
    expect(source).toContain('placeholder="Describe the existing issue"');
    expect(source).toContain('label="Add another"');
    expect(source).toContain(
      "label={editingConditionIssue === null ? 'Save issue' : 'Save changes'}",
    );
    expect(
      source.match(/label=\{editingConditionIssue === null \? 'Save issue' : 'Save changes'\}/g),
    ).toHaveLength(1);
    const issueSheet = source.slice(
      source.indexOf('visible={showConditionIssueForm}'),
      source.indexOf('animationType="fade"', source.indexOf('visible={showConditionIssueForm}')),
    );
    expect(issueSheet.indexOf('</ScrollView>')).toBeLessThan(issueSheet.indexOf('<Action'));
    expect(issueSheet).toContain('styles.conditionSheetFooter');
    expect(issueSheet).toContain('paddingBottom: conditionSheetBottomAllowance');
    expect(issueSheet).toContain("behavior={Platform.OS === 'ios' ? 'padding' : undefined}");
    expect(source).not.toContain(
      'label="Cancel"\n                      onPress={() => {\n                        Keyboard.dismiss();\n                        setConditionDescription',
    );
    expect(source).toContain('conditionIssues.map(conditionIssuePayload)');
    expect(source).toContain('issueForm: {\n    backgroundColor: colors.surface');
    expect(source).toContain('<Text style={styles.cardTitle}>Known vehicle issues</Text>');
    expect(source).toContain('<Text style={styles.cardTitle}>New issues</Text>');
    expect(source).not.toContain('No active known issues are recorded for this vehicle.');
    expect(source).not.toContain('showConditionIssueDetails');
    expect(source).toContain('style={styles.destructiveSecondary}');
    expect(source).toContain('accessibilityLabel={`Remove ${domainLabel(issue.category)} issue`}');
  });

  it('keeps overdue recovery compact and preserves native timestamp authority', () => {
    const ownerPanel = source.slice(
      source.indexOf('export function OwnerRentalPanel'),
      source.indexOf('function OwnerOverdueRecoveryAction'),
    );
    const recovery = source.slice(
      source.indexOf('function OwnerOverdueRecoveryAction'),
      source.indexOf('function EvidenceWaiverAction'),
    );

    expect(ownerPanel).toContain('style={[styles.overdueCard, styles.compactOverdueCard]}');
    expect(ownerPanel).toContain('Complete the outstanding handover step.');
    expect(ownerPanel).toContain('label="Continue handover"');
    expect(recovery).toContain('<HandoverDateTimeControl');
    expect(recovery).not.toContain('Vehicle given to renter');
    expect(recovery).toContain('dateLabel="Date of handover"');
    expect(recovery).toContain('timeLabel="Time of handover"');
    expect(recovery).toContain('dateLabel="Date of return"');
    expect(recovery).toContain('timeLabel="Time of return"');
    expect(recovery).toContain(
      "minimumDate={scope === 'BOTH' ? pickupAt : new Date(detail.actualPickupAt!)}",
    );
    expect(recovery).toContain('minimumDate={new Date(detail.rentalStart)}');
    expect(recovery).toContain("maximumDate={scope === 'BOTH' ? returnAt : maximumDate}");
    expect(recovery).toContain('<DateOnlyField');
    expect(recovery).toContain('compact');
    expect(recovery).toContain('mode="time"');
    expect(source).toContain("handoverDateTimeControl: {\n    alignItems: 'flex-start'");
    expect(source).toContain("flexDirection: 'row'");
    expect(recovery).not.toContain('both reported handover times are accepted automatically');
    expect(recovery).toContain('<Modal');
    expect(recovery).toContain('visible={open}');
    expect(recovery).toContain('adaptiveSheetLayout({');
    expect(recovery).toContain('safeAreaAllowance: 0');
    expect(recovery).toContain('useSharedValue(Math.min(520, maximumHeight))');
    expect(recovery).toContain('<BackControl label="Cancel" onPress={() => setOpen(false)} />');
    expect(recovery).toContain('setPickupAt(new Date(Math.min(');
    expect(recovery).toContain('setReturnAt(now)');
    expect(recovery).toContain('Complete the handover and record the actual transfer time.');
    expect(recovery).not.toContain('label="Continue handover"');
    expect(source).toContain("preSubmitAction: 'Complete handover without inspection'");
    expect(source).toContain("sheetTitle: 'Complete handover without inspection'");
    expect(source).toContain("preSubmitAction: 'Complete return without inspection'");
    expect(source).toContain("sheetTitle: 'Complete return without inspection'");
    expect(recovery).toContain('label={presentation.preSubmitAction}');
    expect(recovery).toContain('presentation.completedAction');
    expect(recovery).toContain('disabled={action.isPending || Boolean(timestampError)}');
  });

  it('uses authoritative recovery state for a neutral, non-actionable post-submit card', () => {
    const ownerPanel = source.slice(
      source.indexOf('export function OwnerRentalPanel'),
      source.indexOf('function OwnerOverdueRecoverySubmittedStatus'),
    );
    const submitted = source.slice(
      source.indexOf('function OwnerOverdueRecoverySubmittedStatus'),
      source.indexOf('function OwnerOverdueRecoveryAction'),
    );
    const preSubmit = source.slice(
      source.indexOf('function OwnerOverdueRecoveryAction'),
      source.indexOf('function HandoverDateTimeControl'),
    );

    expect(ownerPanel).toContain(
      'detail.overdueHandoverRecovery && !detail.overdueHandoverRecovery.acceptance',
    );
    expect(ownerPanel).toContain(
      '<OwnerOverdueRecoverySubmittedStatus recovery={detail.overdueHandoverRecovery} />',
    );
    expect(source).toContain("recordedTitle: 'Handover recorded'");
    expect(source).toContain("recordedTitle: 'Return recorded'");
    expect(submitted).toContain('{presentation.recordedTitle}');
    expect(submitted).toContain("disputed ? 'Operations review' : 'Awaiting renter'");
    expect(submitted).toContain('dateTimeLabel(recovery.reportedPickupAt)');
    expect(submitted).toContain('dateTimeLabel(recovery.responseDeadlineAt)');
    expect(submitted).not.toContain('warningCard');
    expect(submitted).not.toContain('Complete handover without inspection');
    expect(preSubmit).toContain('{presentation.warningTitle}');
    expect(preSubmit).toContain('label={presentation.preSubmitAction}');
    expect(preSubmit).toContain('apiClient.request<RentalDetail>');
    expect(preSubmit).toContain(
      "client.setQueryData(['owner-workspace', workspaceKey, 'rental', reference], result)",
    );
    expect(source).toContain(
      "detail.status === 'READY_FOR_PICKUP' &&\n        showCompactRentalActions &&\n        !pickup",
    );
  });

  it('keeps multi-photo capture available with compact per-slot upload locking', () => {
    expect(source).toContain("const multiPerspectives = ['INTERIOR', 'DASHBOARD', 'ADDITIONAL']");
    expect(source).toContain('label={`Add another');
    expect(source).toContain(
      'disabled={capture.isPending && capture.variables?.perspective === perspective}',
    );
    expect(source).toContain("capture.mutate({ mode: 'append', perspective })");
    expect(source).toContain('secondaryInline: {');
    expect(source).toContain('minHeight: 44');
    expect(source).toContain("justifyContent: 'center'");
    expect(source).toContain("textAlign: 'center'");
    expect(source).toContain("additionalPhotoAction: { alignItems: 'flex-end' }");
    expect(photoSlotSource).toContain('icon="camera-outline"');
    expect(photoSlotSource).toContain("justifyContent: 'space-between'");
  });

  it('preserves pickup inspection completion and submission authority', () => {
    expect(source).toContain('hasRequiredPhotos(inspectionFiles)');
    expect(source).toContain('Boolean(odometer)');
    expect(source).toContain("conditionDisclosureState !== 'NOT_REVIEWED'");
    expect(source).toContain("conditionDisclosureState === 'ISSUES_REPORTED'");
    expect(source).toContain('odometerMeters: String(Math.round(Number(odometer) * 1000))');
    expect(source).toContain('fuelBasisPoints: Math.round(Number(fuel) * 100)');
    expect(source).toContain('batterySocBasisPoints: Math.round(Number(soc) * 100)');
    expect(source).toContain('media: inspectionMedia(inspectionFiles)');
    expect(source).toContain('conditionIssues.map(conditionIssuePayload)');
    expect(source).toContain("action.mutate('inspection')");
    expect(source).toContain("action.mutate('incident')");
    expect(source).toContain('onOpenConversation');
  });

  it('uses persisted inspection state for the compact post-inspection handover flow', () => {
    expect(source).toContain('<StatusBadge label="Submitted" />');
    expect(source).toContain('<PickupInspectionSummary inspection={pickup} />');
    expect(source).toContain('Vehicle condition');
    expect(source).toContain('Vehicle readings');
    expect(source).toContain('Evidence');
    expect(source).toContain('Pickup verification');
    expect(source).toContain(
      "inspection.notes === 'Pickup inspection submitted from owner mobile mode.'",
    );
    expect(source).toContain('label="View photos"');
    expect(source).toContain('label={`View supporting photos (${evidenceItems.length})`}');
    expect(source).toContain('accessibilityLabel="6-digit pickup code"');
    expect(source).toContain('disabled={code.length !== 6 || action.isPending}');
    expect(source).toContain("action.mutate('verify')");
    expect(source).toContain('showCompactRentalActions &&\n        !pickup');
  });

  it('keeps the renter pickup handover on authoritative persisted state', () => {
    expect(bookingsSource).not.toContain('OWNER MODE');
    expect(bookingsSource).toContain('label="All bookings"');
    expect(bookingsSource).toContain('eyebrow="Booking details"');
    expect(source).toContain(
      'const pickupRecoveryRequired = pickupOverdue && !pickup && !startWaiverSubmitted;',
    );
    expect(source).toContain('{pickupRecoveryRequired && !returnOverdue');
    expect(source).toContain("detail.status === 'READY_FOR_PICKUP' && pickup && !pickupCode");
    expect(source).toContain("if (status === 'ACTIVE') return 'Your rental is in progress.");
    expect(source).toContain('Review pickup condition');
    expect(source).toContain('requesting your single-use pickup code');
    expect(source).not.toContain('Enter the pickup code');
    expect(bookingsSource).toContain("['CONFIRMED', 'READY_FOR_PICKUP'].includes(booking.status)");
  });

  it('uses a shared compact post-handover hierarchy with role-specific next steps', () => {
    const renterPanel = source.slice(
      source.indexOf('export function RenterRentalPanel'),
      source.indexOf('export function OwnerRentalPanel'),
    );
    const ownerPanel = source.slice(
      source.indexOf('export function OwnerRentalPanel'),
      source.indexOf('function OwnerOverdueRecoveryAction'),
    );

    expect(source.match(/label="Actual handover"/g)).toHaveLength(3);
    expect(source).toContain("ACTIVE: 'Rental in progress'");
    expect(source).toContain('function RentalVehicleReadings');
    expect(renterPanel).toContain('Return the vehicle by ${dateTimeLabel(detail.rentalEnd)}.');
    expect(renterPanel).toContain('<Action label="Start return"');
    expect(renterPanel).toContain('<Text style={styles.sectionTitle}>Trip actions</Text>');
    expect(renterPanel).toContain('label="Report operational issue"');
    expect(ownerPanel).toContain('Waiting for the renter to begin return.');
    expect(ownerPanel).toContain('<Text style={styles.sectionTitle}>Rental actions</Text>');
    expect(ownerPanel).toContain('label="Report incident"');
    expect(ownerPanel).toContain('label="Message"');
    expect(ownerPanel).not.toContain('label="Start return"');
    expect(ownerPanel).not.toContain('label="Extend Trip"');
    expect(bookingsSource).toContain("['CONFIRMED', 'READY_FOR_PICKUP'].includes(booking.status)");
    expect(ownerRentalsSource).toContain(
      "['CONFIRMED', 'READY_FOR_PICKUP'].includes(selectedBooking.status)",
    );
  });

  it('presents the owner return-pending state as a passive waiting step until evidence arrives', () => {
    const ownerPanel = source.slice(
      source.indexOf('export function OwnerRentalPanel'),
      source.indexOf('function OwnerOverdueRecoveryAction'),
    );
    const waitingState = ownerPanel.slice(
      ownerPanel.indexOf("detail.status === 'RETURN_PENDING' &&\n        !returned"),
      ownerPanel.indexOf("detail.status === 'RETURN_PENDING' && returned"),
    );

    expect(ownerPanel).toContain("['ACTIVE', 'RETURN_PENDING'].includes(detail.status)");
    expect(ownerPanel).toContain('label="Actual handover"');
    expect(waitingState).toContain('Waiting for the renter to complete the return inspection.');
    expect(waitingState).toContain(
      'Return photos and vehicle readings will appear here once submitted.',
    );
    expect(waitingState).not.toContain('<Action');
    expect(ownerPanel).toContain("detail.status === 'RETURN_PENDING' && returned");
    expect(ownerPanel).toContain('<ReturnInspectionEvidence inspection={returned} />');
    expect(ownerPanel).toContain("['RETURN_PENDING', 'RETURNED'].includes(detail.status) ? (");
    expect(ownerPanel).toContain('label="Report incident"');
    expect(ownerPanel).toContain('label="Message"');
    expect(ownerRentalsSource).toContain(
      "['CONFIRMED', 'READY_FOR_PICKUP'].includes(selectedBooking.status)",
    );
    expect(ownerRentalsSource).toContain('refetchInterval: selected ? 5_000 : false');
  });

  it('presents renter-submitted return evidence as a compact authorized owner review', () => {
    const returnEvidence = source.slice(
      source.indexOf('function ReturnInspectionEvidence'),
      source.indexOf('function InspectionEvidence'),
    );

    expect(returnEvidence).toContain('Return evidence');
    expect(returnEvidence).toContain('Submitted by renter');
    expect(returnEvidence).not.toContain('Vehicle readings');
    expect(returnEvidence).not.toContain('label="Odometer"');
    expect(returnEvidence).toContain('Condition notes');
    expect(returnEvidence).toContain(
      "inspection.notes === 'Return inspection submitted by the renter during vehicle handover.'",
    );
    expect(returnEvidence).toContain('label="View photos"');
    expect(returnEvidence).toContain('{item.title} · {index + 1} of {gallery.length}');
    expect(returnEvidence).toContain('<AuthorizedInspectionImage');
    expect(returnEvidence).toContain('accessibilityLabel="Back from return photos"');
    expect(source).toContain('/files/${fileAssetId}/access-grants');
    expect(source).toContain(
      'Review the renter&apos;s return evidence and confirm the vehicle was received.',
    );
    expect(source).toContain('label="Confirm vehicle received"');
    expect(source).toContain('label="Report return discrepancy"');
    expect(source).toContain("action.mutate('disagree')");
    expect(source).toContain('label="Report incident"');
    expect(source).toContain("action.mutate('incident')");
    expect(source).toContain('label="Message"');
    expect(source).toContain("action.mutate('agree')");
    const ownerPanel = source.slice(
      source.indexOf('export function OwnerRentalPanel'),
      source.indexOf('function OwnerOverdueRecoveryAction'),
    );
    const ownerSubmittedReturn = ownerPanel.slice(
      ownerPanel.indexOf("detail.status === 'RETURN_PENDING' && returned"),
      ownerPanel.indexOf("detail.status === 'RETURNED'"),
    );
    expect(ownerSubmittedReturn).toContain(
      '<RentalVehicleReadings inspection={returned} title="Return readings" />',
    );
    expect(ownerSubmittedReturn.indexOf('<RentalVehicleReadings')).toBeLessThan(
      ownerSubmittedReturn.indexOf('<ReturnInspectionEvidence'),
    );
    expect(ownerSubmittedReturn.indexOf('<ReturnInspectionEvidence')).toBeLessThan(
      ownerSubmittedReturn.indexOf('styles.nextStepCard'),
    );
    expect(ownerSubmittedReturn).not.toContain(
      'inline\n                label="Report return discrepancy"',
    );
  });

  it('keeps renter return-pending copy singular and groups authoritative return readings', () => {
    const renterPanel = source.slice(
      source.indexOf('export function RenterRentalPanel'),
      source.indexOf('export function OwnerRentalPanel'),
    );
    const submittedReturnState = renterPanel.slice(
      renterPanel.indexOf("detail.status === 'RETURN_PENDING' && returned"),
      renterPanel.indexOf("(detail.status === 'RETURNED' || detail.status === 'COMPLETED')"),
    );

    expect(source).toContain(
      "if (state.hasReturnInspection) return 'Waiting for the owner to confirm vehicle receipt.';",
    );
    expect(submittedReturnState).toContain(
      '<RentalVehicleReadings inspection={returned} title="Return readings" />',
    );
    expect(submittedReturnState).not.toContain('<ReturnInspectionEvidence');
    expect(submittedReturnState).not.toContain('Waiting for owner to confirm vehicle receipt.');
    expect(submittedReturnState).not.toContain('Return odometer:');
    expect(source).toContain("title = 'Vehicle readings'");
    expect(source).toContain('inspection.fuelBasisPoints !== null');
    expect(source).toContain('inspection.batterySocBasisPoints !== null');
    expect(bookingsSource).toContain('label="Booking details"');
    expect(bookingsSource).toContain('label="Message"');
    expect(bookingsSource).toContain(
      "booking.status === 'RETURN_PENDING' && styles.bookingActionsSectionCompact",
    );
    expect(bookingsSource).toContain(
      "booking.status === 'RETURN_PENDING' && styles.bookingActionGridBalanced",
    );
    expect(bookingsSource).toContain("bookingActionGridBalanced: { flexWrap: 'nowrap' }");
    expect(bookingsSource).toContain("['CONFIRMED', 'READY_FOR_PICKUP'].includes(booking.status)");
    expect(renterPanel).toContain(
      "(detail.status === 'RETURNED' || detail.status === 'COMPLETED')",
    );
  });

  it('presents renter post-return usage, claim window, and claim status in lifecycle order', () => {
    const renterPanel = source.slice(
      source.indexOf('export function RenterRentalPanel'),
      source.indexOf('export function OwnerRentalPanel'),
    );

    expect(renterPanel).toContain(
      "['ACTIVE', 'RETURN_PENDING', 'RETURNED', 'COMPLETED'].includes(detail.status)",
    );
    expect(renterPanel).toContain("!['RETURNED', 'COMPLETED'].includes(detail.status)");
    expect(renterPanel).toContain('<UsageSummary audience="renter" detail={detail} />');
    expect(renterPanel).toContain('<RenterPostReturnStatus');
    expect(source).toContain('The owner may submit eligible return claims before this deadline.');
    expect(source).toContain('No additional charges have been submitted.');
    expect(source).toContain(
      'Your return is complete. We’ll notify you if the owner submits a claim before the',
    );
    expect(source).toContain('The claim window has closed and no return claim was submitted.');
    expect(source).toContain('Return claim');
    expect(source).toContain('We’ll notify you when the claim review is complete.');
    expect(source).toContain("RENTER_REVIEW: 'Needs your review'");
    expect(source).toContain("UNDER_ADMIN_REVIEW: 'Under review'");
    expect(source).not.toContain('<UsageSummary detail={detail} />');
  });

  it('moves owner post-return claims into an adaptive sheet with authoritative measurements', () => {
    expect(source).toContain('label="Vehicle received"');
    expect(source).toContain('Measured usage');
    expect(source).toContain('label="Distance travelled"');
    expect(source).toContain('label="Included mileage"');
    expect(source).toContain('label="Excess mileage"');
    expect(source).toContain('label="Late return"');
    expect(source).toContain('Claim window');
    expect(source).toContain('Submit any eligible return claims before this deadline.');
    expect(source).not.toContain('No additional charge has been created.');
    expect(source).not.toContain('Start a controlled claim');
    expect(source).not.toContain('{claimCategories.map((category) => (');
    expect(source).toContain(
      "label={detail.postReturnClaims.length ? 'Add another claim' : 'Start a claim'}",
    );
    expect(source).toContain('visible={showClaimSheet}');
    expect(source).toContain('<BackControl label="Back" onPress={closeClaimSheet} />');
    expect(source).toContain('Select the return issue you want to report.');
    expect(source).toContain('label="Claim type"');
    expect(source).toContain('options={eligibleClaimCategories.map');
    expect(source).toContain("if (category === 'EXCESS_MILEAGE')");
    expect(source).toContain("if (category === 'FUEL_DEFICIENCY')");
    expect(source).toContain("if (category === 'EV_BATTERY_DEFICIENCY')");
    expect(source).toContain("if (category === 'LATE_RETURN')");
    expect(source).toContain('<ClaimMeasuredValue category={claimCategory} detail={detail} />');
    expect(source).toContain("label={action.isPending ? 'Submitting…' : 'Submit claim'}");
    expect(source).toContain("onPress={() => action.mutate('claim')}");
    expect(source).toContain("['RETURN_PENDING', 'RETURNED'].includes(detail.status)");
    expect(source).toContain('category: claimCategory');
    expect(source).toContain('description: claimDescription');
    expect(source).toContain("['CLEANING', 'DAMAGE'].includes(claimCategory)");
  });

  it('offers the owner one recovery action for exactly the overdue phases', () => {
    expect(source).toContain("const overdueRecoveryScope: 'START' | 'RETURN' | 'BOTH' | null =");
    expect(source).toContain('pickupOverdue && !pickup && !startWaived && returnRecoveryOverdue');
    expect(source).toContain("? 'BOTH'");
    expect(source).toContain('{overdueRecoveryScope &&');
    expect(source).toContain('!detail.overdueHandoverRecovery &&');
    expect(source).toContain(
      'pickupOverdue && !pickup && !startWaived && !overdueRecoveryScope && (',
    );
    expect(source).toContain('<OwnerOverdueRecoveryAction');
    expect(source).toContain('scope={overdueRecoveryScope}');
    expect(source).toContain('workspaceKey={workspaceKey}');
    expect(source).toContain(
      "client.setQueryData(['owner-workspace', workspaceKey, 'rental', reference], result)",
    );
    expect(source).toContain(
      "detail.fulfillment.startMethod === 'OWNER_DELIVERY' &&\n        canHandover &&\n        !pickupOverdue &&",
    );
    expect(
      source.match(
        /detail\.fulfillment\.startMethod === 'OWNER_DELIVERY' &&\n\s*(?:canHandover &&\n\s*)?!pickupOverdue &&/g,
      ),
    ).toHaveLength(2);
    expect(source).toContain(
      'needsInspection &&\n        !handoverStarted &&\n        !pickupHandoverReady &&\n        !pickupOverdue',
    );
    expect(source).toContain(
      'pickupHandoverReady &&\n        !pickupOverdue &&\n        !detail.overdueHandoverRecovery',
    );
    expect(source).toContain('Handover recorded');
    expect(source).toContain("disputed ? 'Operations review' : 'Awaiting renter'");
    expect(source).toContain('label="Actual handover"');
    expect(source).toContain('label="Renter response due"');
    expect(source).toContain('No response accepts the report automatically.');
    expect(source).toContain("warningTitle: 'Return overdue'");
    expect(source).toContain("warningTitle: 'Handover overdue'");
    expect(source).toContain("? 'Pickup and Return overdue'");
    expect(source).toContain("? 'Pickup overdue'");
    expect(source).toContain("? 'Return overdue'");
    expect(source).toContain('value={rentalTripSummary(detail.rentalStart, detail.rentalEnd)}');
    expect(source).toContain("detail.status === 'ACTIVE' && !returnRecoveryOverdue ? (");
    expect(source).toContain(
      "detail.workflowCompliance?.return.evidenceOutcome !== 'WAIVED' &&\n        !overdueRecoveryScope",
    );
    expect(source).toContain(
      'detail.workflowCompliance?.return.overdue &&\n        !returnWaived &&\n        !overdueRecoveryScope',
    );
    expect(source).toContain('<Text style={styles.overdueStatus}>Payout remains pending</Text>');
    expect(source).toContain('Date of handover');
    expect(source).toContain('Time of handover');
    expect(source).toContain('Date of return');
    expect(source).toContain('Time of return');
    expect(source).toContain(
      'The renter is notified and has 24 hours to disagree with the reported time.',
    );
    expect(source).toContain("alertTitle: 'Complete handover without inspection?'");
    expect(source).toContain("alertTitle: 'Complete return without inspection?'");
    expect(source).not.toContain('Notify renter and start 24-hour review');
    expect(source).toContain('/rental/overdue-handover-recovery');
    expect(source).toContain('Return exception');
    expect(source).toContain('Return reported without inspection');
    expect(source).toContain('label="Reported return"');
    expect(source).toContain('label="Respond by"');
    expect(source).toContain("renterConfirmAction: 'Confirm handover report'");
    expect(source).toContain("renterConfirmAction: 'Confirm return report'");
    expect(source).toContain('label={presentation.renterConfirmAction}');
    expect(source).toContain('label="Dispute report"');
    expect(source).not.toContain('Owner reported Return without inspection');
    expect(source).not.toContain('label="I disagree"');
    expect(source).toContain(
      'If you do not respond by the deadline, the report is accepted automatically.',
    );
    expect(source).toContain('report awaiting your response`');
    expect(source).toContain('label="Actual handover"');
    expect(source).not.toContain('The reported times are correct');
    expect(source).toContain('Send disagreement to Operations');
    expect(source).toContain('No inspection measurements or condition baseline will be created.');
    expect(source).toContain(
      '!startWaived && pickup ? <RentalVehicleReadings inspection={pickup} /> : null',
    );
    expect(bookingsSource).toContain(
      'operational && now >= new Date(booking.pickupWindow?.opensAt ?? booking.rentalStart).getTime();',
    );
    expect(bookingsSource).toContain('{pickupHasBegun && rentalOperations}');
    expect(bookingsSource).toContain('{!pickupHasBegun && !acceptedUpcoming && rentalOperations}');
    expect(bookingsSource).toContain('label="Booking details"');
    expect(source).toContain('style={[styles.panel, styles.renterPanel]}');
    expect(source).toContain('<StatusBadge label={renterStatusLabel} />');
    expect(source).toContain('label="Dates & time"');
    expect(source).toContain('rentalTripSummary(detail.rentalStart, detail.rentalEnd)');
    expect(source).toContain('<Text style={styles.actionEyebrow}>Next step</Text>');
    expect(source).toContain('Waiting for the owner to complete pickup inspection.');
    expect(source).not.toContain('Pickup scheduled:');
    expect(source).not.toContain('Scheduled return:');
    expect(source).not.toContain('Vehicle handover is available from');
    expect(bookingsSource).toContain('<Text style={styles.sectionTitle}>Booking actions</Text>');
    expect(bookingsSource).toContain('label="Message"');
    expect(bookingsSource).toContain('{(booking.conversationId || canChangeBooking) && (');
    expect(bookingsSource).not.toContain('<SectionHeader title="Trip timeline" />');
    expect(bookingsSource).not.toContain('booking.statusHistory.map');
    expect(bookingsSource).toContain('<Text style={styles.dangerEyebrow}>Danger zone</Text>');
    expect(bookingsSource).toContain('Only cancel when necessary.');
    expect(bookingsSource).toContain('`Action required: Confirm ${scopeLabel}`');
    expect(bookingsSource).toContain('Response due: {dateTimeLabel(recovery.responseDeadlineAt)}');
    expect(bookingsSource).toContain('handover reports need your response');
    expect(bookingsSource).toContain('Under Operations review');
    expect(bookingsSource).toContain('label="Review handover"');
    expect(source).toContain('scrollToRecoveryResponse?.(');
    expect(bookingsSource).toContain('presentationStyle="overFullScreen"');
    expect(bookingsSource).toContain('adaptiveSheetLayout({');
    expect(bookingsSource).toContain('onContentSizeChange={(_width, height) =>');
    expect(bookingsSource).toContain('scrollEnabled={bookingDetailsLayout.scrollEnabled}');
    expect(bookingsSource).toContain('visible={bookingDetailsOpen}');
    expect(bookingsSource).toContain(
      '<BackControl label="Back" onPress={() => setBookingDetailsOpen(false)} />',
    );
    expect(bookingsSource).not.toContain('accessibilityLabel="Close booking details"');
    expect(bookingsSource).toContain('{!pickupHasBegun && (');
  });

  it('preloads active vehicle issues and snapshots newly discovered issues once', () => {
    expect(source).toContain('Known vehicle issues');
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
