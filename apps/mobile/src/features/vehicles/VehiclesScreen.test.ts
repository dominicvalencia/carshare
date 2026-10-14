import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'VehiclesScreen.tsx'),
  'utf8',
);
const securePhotoSlotSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../ui/SecureCameraPhotoSlot.tsx'),
  'utf8',
);
const primitivesSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../ui/primitives.tsx'),
  'utf8',
);

describe('Manager vehicle proposal media editing', () => {
  it('reuses the shared photo and document editors in proposal mode', () => {
    const editor = source.slice(
      source.indexOf('function ManagerVehicleProposalEditor('),
      source.indexOf('function ManagerOperationalVehicleEditor('),
    );
    expect(editor).toContain('<PhotosStep');
    expect(editor).toContain('<DocumentsStep');
    expect(editor).toContain('proposalMode');
    expect(editor).toContain('beforeMutation={persistProposalDraft}');
    expect(editor).toContain('Current marketplace details stay live');
  });

  it('targets proposal routes and keeps uploads private or sensitive', () => {
    expect(source).toContain('`${proposalBase}/${proposal.data.id}`');
    expect(source).toContain("apiClient.upload<SafeFile>('/files', 'PRIVATE'");
    expect(source).toContain("apiClient.upload<SafeFile>('/files', 'SENSITIVE'");
    expect(source).toContain('removeProposalDocument(endpointBase, definitionId');
  });
});

describe('Phase 12 owner vehicle acceptance UX', () => {
  it('renders the compact Fleet hierarchy without changing list navigation or Add vehicle', () => {
    const fleet = source.slice(
      source.indexOf('function ActualOwnerVehiclesScreen('),
      source.indexOf('function FleetVehicleCard('),
    );

    expect(fleet).toContain('<Text style={styles.eyebrow}>OWNER FLEET</Text>');
    expect(fleet).toContain('<Text style={styles.fleetTitle}>My vehicles</Text>');
    expect(fleet).toContain('Drafts are saved automatically');
    expect(fleet).toContain("apiClient.request<Vehicle>('/owner/vehicles'");
    expect(fleet).toContain('<Text style={styles.primaryText}>Add vehicle</Text>');
    expect(fleet).toContain('onPress={() => create.mutate()}');
    expect(fleet).toContain('onPress={() => setSelectedId(vehicle.id)}');
    expect(fleet).toContain('title="No vehicles yet"');
    expect(fleet).toContain('title="Fleet unavailable"');
  });

  it('prioritizes identity, status, rate, compact metadata, and marketplace state', () => {
    const card = source.slice(
      source.indexOf('function FleetVehicleCard('),
      source.indexOf('function VehicleDetail('),
    );

    expect(card).toContain('vehicle.photos.find(({ isCover }) => isCover) ?? vehicle.photos[0]');
    expect(card).toContain('accessibilityLabel={`${title} cover photo`}');
    expect(card).toContain('vehicleStatusLabel(vehicle.status)');
    expect(card).toContain('money(policy.dailyRateMinor)');
    expect(card).toContain('[vehicle.category?.name, vehicle.location?.city]');
    expect(card).toContain(".join(' · ')");
    expect(card).toContain('fleetMarketplaceStatus(vehicle)');
    expect(card).toContain('fleetDistinctAvailabilityLabel(vehicle.availabilityToday)');
    expect(card).toContain("? 'Review vehicle'");
    expect(card).toContain("? 'Continue setup'");
    expect(card).toContain(": 'Manage vehicle'");
  });

  it('keeps draft cards simplified while using the same whole-card route', () => {
    const card = source.slice(
      source.indexOf('function FleetVehicleCard('),
      source.indexOf('function VehicleDetail('),
    );

    expect(card).toContain("const draft = vehicle.status === 'DRAFT'");
    expect(card).toContain("'Untitled vehicle draft'");
    expect(card).toContain('<Text style={styles.fleetDraftState}>');
    expect(card).toContain("? 'Waiting for Owner review'");
    expect(card).toContain(": 'Review the Manager submission'");
    expect(card).toContain(": 'Setup in progress'");
    expect(card).toContain('{draft ? (');
    expect(card).toContain('{policy && <Text style={styles.fleetRate}>');
    expect(card).toContain('onPress={onPress}');
    expect(card).toContain('accessibilityRole="button"');
  });

  it('keeps marketplace lifecycle and today availability distinct but visually secondary', () => {
    expect(source).toContain("return 'Awaiting marketplace approval'");
    expect(source).toContain("? 'Marketplace available'");
    expect(source).toContain(": 'Marketplace unavailable'");
    expect(source).toContain("value.state === 'MARKETPLACE_UNAVAILABLE'");
    expect(source).toContain('return null');
    expect(source).toContain('return availabilityTodayLabel(value)');
  });

  it('aligns standard and draft actions through one compact card authority', () => {
    expect(source).toContain('const actionLabel = awaitingOwnerApproval');
    expect(source).toContain("? 'Review vehicle'");
    expect(source).toContain("{delegated ? 'View vehicle' : actionLabel} →");
    expect(source).toContain("marginTop: 'auto'");
    expect(source).toContain('fleetContent: { flex: 1, gap: spacing.xxs, minHeight: 120');
    expect(source).toContain("fleetImage: { alignSelf: 'stretch'");
    expect(source).toContain('minHeight: 120, width: 108');
  });

  it('organizes every Step 1 field into a guided vehicle-details flow', () => {
    const details = source.slice(
      source.indexOf('function DetailsStep('),
      source.indexOf('function FeaturesStep('),
    );

    for (const section of [
      'Vehicle identity',
      'Powertrain',
      'Vehicle details',
      'About your vehicle',
    ]) {
      expect(details).toContain(`title="${section}"`);
    }
    for (const field of [
      'Make',
      'Model',
      'Model year',
      'Vehicle type',
      'Powertrain',
      'Fuel',
      'Color',
      'Plate number',
      'Description',
    ]) {
      expect(details).toContain(`label="${field}"`);
    }
  });

  it('preserves Step 1 draft values, dependencies, payload, and continue behavior', () => {
    const details = source.slice(
      source.indexOf('function DetailsStep('),
      source.indexOf('function FeaturesStep('),
    );

    expect(details).toContain("make: vehicle.make ?? ''");
    expect(details).toContain("model: vehicle.model ?? ''");
    expect(details).toContain("modelYear: vehicle.modelYear?.toString() ?? ''");
    expect(details).toContain("setForm({ ...form, make, model: '' })");
    expect(details).toContain(
      "fuelType: powertrain === 'BATTERY_ELECTRIC' ? 'ELECTRIC' : 'GASOLINE'",
    );
    expect(details).toContain('body: JSON.stringify({');
    expect(details).toContain('categoryId: form.categoryId || undefined');
    expect(details).toContain("lastCompletedSection: 'DETAILS'");
    expect(details).toContain(
      'modelYear: form.modelYear.trim() ? Number(form.modelYear) : undefined',
    );
    expect(details).toContain('onSuccess: () =>');
    expect(details).toContain('onContinue();');
    expect(details).toContain('<WizardSaveFooter mutation={save} />');
    expect(details).toContain('<ScrollView');
  });

  it('uses useful placeholders, private plate guidance, and a multiline optional description', () => {
    const details = source.slice(
      source.indexOf('function DetailsStep('),
      source.indexOf('function FeaturesStep('),
    );

    expect(details).toContain('placeholder="Enter model year"');
    expect(details).toContain('placeholder="Enter vehicle color"');
    expect(details).toContain('placeholder="ABC 1234"');
    expect(details).toContain('Kept private and not shown on your public listing.');
    expect(details).toContain('<DetailsFormSection optional title="About your vehicle">');
    expect(details).toContain('multiline');
    expect(details).toContain('placeholder="Tell renters anything useful about your vehicle"');
  });

  it('simplifies the Step 1 header without changing Fleet navigation or later steps', () => {
    expect(source).toContain("step <= 1 && value.status === 'DRAFT'");
    expect(source).toContain("? 'Add vehicle'");
    expect(source).toContain("? 'Vehicle draft'");
    expect(source).toContain("step === 0 ? 'Vehicle details' : steps[step]");
    expect(source).toContain('<BackControl label="Fleet" onPress={onClose} />');
    expect(source).toContain('step > 0 && (');
    expect(source).toContain(
      'style={[styles.editorActions, step === 3 && styles.documentEditorActions]}',
    );
  });

  it('renders Step 2 after Step 1 advances without referencing a browser location global', () => {
    const features = source.slice(
      source.indexOf('function FeaturesStep('),
      source.indexOf('function PhotosStep('),
    );

    expect(features).toContain('<WizardSaveFooter mutation={save} onPrevious={onPrevious} />');
    expect(features).not.toContain('disabled={!location}');
  });

  it('groups the server-owned Step 2 feature catalog without changing persisted IDs', () => {
    const features = source.slice(
      source.indexOf('const vehicleFeatureGroups'),
      source.indexOf('function PhotosStep('),
    );

    for (const group of ['Comfort', 'Connectivity', 'Parking & safety', 'Other']) {
      expect(features).toContain(`title: '${group}'`);
    }
    for (const code of [
      'AIR_CONDITIONING',
      'REAR_AIR_CONDITIONING',
      'LEATHER_SEATS',
      'PUSH_BUTTON_START',
      'CRUISE_CONTROL',
      'ADAPTIVE_CRUISE_CONTROL',
      'KEYLESS_ENTRY',
      'SUNROOF_MOONROOF',
      'BLUETOOTH',
      'APPLE_CARPLAY',
      'ANDROID_AUTO',
      'WIRELESS_PHONE_CHARGING',
      'USB_CHARGING',
      'GPS_NAVIGATION',
      'BACKUP_CAMERA',
      'CAMERA_360',
      'PARKING_SENSORS',
      'BLIND_SPOT_MONITORING',
      'LANE_KEEPING_ASSIST',
      'AUTOMATIC_EMERGENCY_BRAKING',
      'DASHCAM',
      'CHILD_SEAT_COMPATIBLE',
      'TOLL_RFID',
      'AUTOSWEEP_RFID',
      'EASYTRIP_RFID',
      'FAST_CHARGING_SUPPORT',
      'PORTABLE_CHARGING_CABLE',
      'CHARGING_ADAPTER',
      'REGENERATIVE_BRAKING',
      'V2L_SUPPORT',
      'ONE_PEDAL_DRIVING',
      'BATTERY_PRECONDITIONING',
    ]) {
      expect(features).toContain(`'${code}'`);
    }
    expect(features).toContain("group.title === 'Other' && !knownCodes.has(code)");
    expect(features).toContain(
      'const [selected, setSelected] = useState<string[]>(selectedFeatureIds)',
    );
    expect(features).toContain('selected.includes(feature.id)');
    expect(features).toContain('selected.filter((item) => item !== feature.id)');
    expect(features).toContain('[...selected, feature.id]');
    expect(features).toContain('body: JSON.stringify({ featureIds: selected })');
  });

  it('uses responsive accessible feature chips and a live selected count', () => {
    const features = source.slice(
      source.indexOf('function FeaturesStep('),
      source.indexOf('function PhotosStep('),
    );
    const chip = source.slice(
      source.indexOf('function FeatureChip('),
      source.indexOf('function DepositRequirementSelector('),
    );

    expect(features).toContain('{selected.length} selected');
    expect(features).toContain('accessibilityLiveRegion="polite"');
    expect(features).toContain('<FeatureChip');
    expect(chip).toContain('accessibilityRole="checkbox"');
    expect(chip).toContain('accessibilityState={{ checked: selected }}');
    expect(chip).toContain('name="checkmark"');
    expect(source).toContain("featureChips: { flexDirection: 'row', flexWrap: 'wrap'");
    expect(source).toContain('minHeight: 44');
  });

  it('shows EV features only for the repository electric and plug-in hybrid powertrains', () => {
    const features = source.slice(
      source.indexOf('const vehicleFeatureGroups'),
      source.indexOf('function PhotosStep('),
    );

    expect(features).toContain("title: 'EV & charging'");
    expect(features).toContain(
      "const evFeaturePowertrains = new Set(['BATTERY_ELECTRIC', 'PLUG_IN_HYBRID'])",
    );
    expect(features).toContain("title !== 'EV & charging' || evFeaturePowertrains.has(powertrain");
    expect(features).toContain('powertrain={value.powertrain}');
    expect(features).not.toContain("new Set(['ICE'");
    expect(features).not.toContain("new Set(['HYBRID'");
    expect(features.indexOf("title: 'EV & charging'")).toBeLessThan(
      features.indexOf("title: 'Other'"),
    );
  });

  it('keeps hidden EV and retired selections in the unchanged feature ID payload', () => {
    const features = source.slice(
      source.indexOf('function FeaturesStep('),
      source.indexOf('function PhotosStep('),
    );

    expect(features).toContain(
      'const [selected, setSelected] = useState<string[]>(selectedFeatureIds)',
    );
    expect(features).toContain('body: JSON.stringify({ featureIds: selected })');
    expect(features).not.toContain('setSelectedFeatureIds');
    expect(features).not.toContain('selected.filter((featureId) => evFeature');
  });

  it('uses dependent reference selectors with a safe custom-model escape hatch', () => {
    expect(source).toContain("['vehicle-models', selectedMake?.id]");
    expect(source).toContain('Other / Model not listed');
    expect(source).toContain('label="Vehicle type"');
    expect(source).toContain('label="Powertrain"');
  });

  it('saves before continuing and protects against duplicate taps', () => {
    expect(source).toContain('<WizardSaveFooter label="Continue" mutation={save}');
    expect(source).toContain('disabled={disabled || mutation.isPending}');
    expect(source).toContain('lastCompletedSection');
  });

  it('is keyboard-aware on Android and requests the rear camera for vehicle evidence', () => {
    expect(source).toContain('KeyboardAvoidingView');
    expect(source).toContain('useKeyboardAwareBottomPadding(spacing.xl)');
    expect(source).toContain('{ paddingBottom: keyboardAwareBottomPadding }');
    expect(source).not.toContain("Platform.OS === 'android' ? 'height' : undefined");
    expect(source).toContain("automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}");
    expect(
      source.match(/cameraType: ImagePicker\.CameraType\.back/g)?.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('shows compact photo categories, shared private location picker, and owner blocks', () => {
    const photos = source.slice(
      source.indexOf('function PhotosStep('),
      source.indexOf('function DocumentsStep('),
    );

    expect(photos).toContain('photoPerspectiveGuidance[perspective]');
    expect(photos).toContain('style={styles.photoCategoryCard}');
    expect(photos).toContain('style={styles.photoEmptyState}');
    expect(photos).toContain('style={styles.photoGrid}');
    expect(photos).toContain('present.length === 1 && styles.photoTileSingle');
    expect(photos).toContain('name="images-outline"');
    expect(photos).toContain('name="ellipsis-horizontal"');
    expect(photos).not.toContain("photo.isCover ? 'Cover' : 'Vehicle photo'");
    expect(source).not.toContain('Position ${photo.displayOrder + 1}');
    expect(source).not.toContain('label="←"');
    expect(photos).toContain("text: 'Set as cover'");
    expect(photos).toContain("text: 'Remove photo'");
    expect(photos).toContain("style: 'destructive'");
    expect(source).toContain('<LocationPicker');
    expect(source).toContain('Kept private from public browsing');
    expect(source).toContain('kind="pickup"');
    expect(source).not.toContain('Use this device at the pickup point');
    expect(source).toContain("['vehicle-blocks', id]");
    expect(source).toContain('Remove unavailable period?');
    expect(source).toContain("text: 'Remove block'");
    expect(source).toContain('Past period · read-only');
  });

  it('presents Step 5 as a private setup summary while preserving canonical save fields', () => {
    const location = source.slice(
      source.indexOf('function LocationStep('),
      source.indexOf('function PolicyStep('),
    );

    expect(location).toContain('No pickup point selected yet');
    expect(location).toContain('Selected pickup location');
    expect(location).toContain('Private location');
    expect(location).toContain('locationDisplayLabel(location)');
    expect(location).toContain('presentation="vehicleSetup"');
    expect(location).toContain('dismissLabel="Back"');
    expect(location).toContain('pickupAreaLabel: location?.displayName');
    expect(location).toContain("timezone: 'Asia/Manila'");
    expect(location).toContain('<WizardSaveFooter disabled={!location}');
    expect(location).not.toContain('latitude}</Text>');
    expect(location).not.toContain('longitude}</Text>');
  });

  it('keeps Step 5 previous and save actions together in the persistent footer', () => {
    const editor = source.slice(
      source.indexOf('function VehicleEditor('),
      source.indexOf('function DetailsStep('),
    );
    const location = source.slice(
      source.indexOf('function LocationStep('),
      source.indexOf('function PolicyStep('),
    );

    expect(editor).toContain('step === 4 ? (');
    expect(editor).toContain('onPrevious={goPrevious}');
    expect(location).toContain(
      '<WizardSaveFooter disabled={!location} mutation={save} onPrevious={onPrevious} />',
    );
    expect(location).toContain('<Button\n              compact');
  });

  it('uses one sticky footer authority with Continue as the default label', () => {
    const editor = source.slice(
      source.indexOf('function VehicleEditor('),
      source.indexOf('function DetailsStep('),
    );
    const footer = source.slice(
      source.indexOf('function WizardSaveFooter('),
      source.indexOf('function Readiness('),
    );

    expect(editor).toContain('step === 0 ? (');
    expect(editor).toContain(') : step === 1 ? (');
    expect(editor).toContain(') : step === 4 ? (');
    expect(footer).toContain("label = 'Continue'");
    expect(footer).toContain("mutation.isPending ? 'Saving…' : label");
    expect(footer).toContain('onPress={() => mutation.mutate()}');
    expect(footer).toContain('onPress={onPrevious}');
  });

  it('splits pricing and handover into an eight-step flow with stable resume markers', () => {
    const stepList = source.slice(source.indexOf('const steps = ['), source.indexOf('] as const;'));
    const completionList = source.slice(
      source.indexOf('const stepCompletionIds = ['),
      source.indexOf('] as const;', source.indexOf('const stepCompletionIds = [')),
    );
    const editor = source.slice(
      source.indexOf('function VehicleEditor('),
      source.indexOf('function DetailsStep('),
    );

    for (const step of [
      'Details',
      'Features',
      'Photos',
      'Documents',
      'Location',
      'Pricing',
      'Handover & usage',
      'Review',
    ]) {
      expect(stepList).toContain(`'${step}'`);
    }
    expect(completionList).not.toContain("'Pricing'");
    expect(completionList).toContain('null');
    expect(completionList).toContain("'Policies'");
    expect(editor).toContain('mode="pricing"');
    expect(editor).toContain('mode="usage"');
    expect(editor).toContain('step === 7 && (');
    expect(editor).toContain('<ReviewStep vehicle={value} action={action.mutate}');
    expect(editor).toContain('Step {step + 1} of {steps.length}');
    expect(editor).toContain('((step + 1) / steps.length) * 100');
    expect(editor).toContain('stepCompletionIds.findIndex');
    expect(editor).toContain('Math.min(completedIndex + 1, steps.length - 1)');
    expect(editor).toContain("completedSection === 'AVAILABILITY'");
    expect(source).toContain(
      "if (mode === 'usage') await markSectionComplete(endpointBase, 'Policies');",
    );
  });

  it('keeps both policy screens on the same immutable payload and sticky save flow', () => {
    const policy = source.slice(
      source.indexOf('function PolicyStep('),
      source.indexOf('function AvailabilityStep('),
    );

    expect(policy).toContain('`${endpointBase}/policy-versions`');
    expect(policy).toContain('dailyRateMinor: Math.round(Number(dailyRate) * 100)');
    expect(policy).toContain('shortDurationDiscountBps');
    expect(policy).toContain('weeklyDiscountBps');
    expect(policy).toContain('extendedTripDiscountBps');
    expect(policy).toContain('monthlyDiscountBps');
    expect(policy).toContain('supportsRenterPickup: renterPickup');
    expect(policy).toContain('supportsOwnerDelivery: ownerDelivery');
    expect(policy).toContain('supportsRenterReturn: renterReturn');
    expect(policy).toContain('supportsOwnerCollection: ownerCollection');
    expect(policy).toContain('mileagePolicy: limited');
    expect(policy).toContain('turnaroundMinutes: turnaround');
    expect(policy).toContain('await onSaved();');
    expect(policy).toContain('<WizardSaveFooter label="Continue" mutation={save}');
    expect(policy).not.toContain("markSectionComplete(id, 'Pricing')");
    expect(policy).not.toContain("markSectionComplete(id, 'Handover')");
    expect(policy).not.toContain('{save.error.message}');
    expect(policy).toContain(
      'We couldn’t save these changes. Check your connection and try again.',
    );
  });

  it('renders Step 8 as an actual-value review with private-safe summaries', () => {
    const review = source.slice(
      source.indexOf('function ReviewStep('),
      source.indexOf('function ReviewSection('),
    );

    expect(review).toContain('<VehicleImage');
    expect(review).toContain('{vehicle.modelYear} {vehicle.make} {vehicle.model}');
    expect(review).toContain('domainLabel(vehicle.transmission)');
    expect(review).toContain('domainLabel(vehicle.powertrain)');
    expect(review).toContain("`${vehicle.seatCount ?? '—'} seats`");
    expect(review).toContain('`${vehicle.location.city}, ${vehicle.location.province}`');
    expect(review).toContain('money(policy.dailyRateMinor)');
    expect(review).not.toContain('latitude');
    expect(review).not.toContain('longitude');
  });

  it('provides complete Step 8 review sections with the correct Edit mappings', () => {
    const review = source.slice(
      source.indexOf('function ReviewStep('),
      source.indexOf('function ReviewSection('),
    );

    for (const [title, step] of [
      ['Basic details', 0],
      ['Photos', 2],
      ['Documents', 3],
      ['Location', 4],
      ['Pricing', 5],
      ['Handover & usage', 6],
    ] as const) {
      expect(review).toContain(`title="${title}"`);
      expect(review).toContain(`onEdit={() => onEdit(${step})}`);
    }
    expect(review).toContain('editLabel="Edit basic details"');
    expect(review).toContain('editLabel="Edit pricing"');
    expect(review).toContain('editLabel="Edit handover and usage"');
  });

  it('summarizes pricing, deposit, photos, documents, and handover without raw dumps', () => {
    const review = source.slice(
      source.indexOf('function ReviewStep('),
      source.indexOf('function ReviewSection('),
    );

    expect(review).toContain("'Long-stay discounts enabled'");
    expect(review).toContain("'No long-stay discounts'");
    expect(review).toContain('deposit required`');
    expect(review).toContain("'No security deposit'");
    expect(review).toContain("'Cover selected'");
    expect(review).toContain('of 3 required documents added');
    expect(review).toContain("'Renter pickup'");
    expect(review).toContain("'Owner delivery'");
    expect(review).toContain("'Unlimited mileage'");
    expect(review).toContain("'Limited mileage'");
    expect(review).toContain('-hour turnaround`');
  });

  it('keeps submission authoritative and hides duplicate submission after review starts', () => {
    const editor = source.slice(
      source.indexOf('function VehicleEditor('),
      source.indexOf('function DetailsStep('),
    );
    const review = source.slice(
      source.indexOf('function ReviewStep('),
      source.indexOf('function ReviewSection('),
    );

    expect(editor).toContain("['DRAFT', 'CHANGES_REQUIRED', 'REJECTED'].includes(value.status)");
    expect(editor).toContain("path: delegated ? '/owner-approval-submission' : '/submission'");
    expect(editor).toContain("'Submit for approval'");
    expect(review).toContain("'AWAITING_REVIEW'");
    expect(review).toContain('Your vehicle has been submitted and is waiting for review.');
    expect(review).not.toContain("path: '/submission'");
    expect(review).toContain("const editable = ['DRAFT', 'CHANGES_REQUIRED', 'REJECTED']");
  });

  it('keeps photo source selection, upload authority, cover ordering, and removal explicit', () => {
    const photos = source.slice(
      source.indexOf('function PhotosStep('),
      source.indexOf('function DocumentsStep('),
    );

    expect(photos).toContain("text: 'Take photo'");
    expect(photos).toContain("text: 'Choose from library'");
    expect(photos).toContain('ImagePicker.launchCameraAsync');
    expect(photos).toContain('ImagePicker.launchImageLibraryAsync');
    expect(photos).toContain("apiClient.upload<SafeFile>('/files', 'PRIVATE'");
    expect(photos).toContain('displayOrder');
    expect(photos).toContain('isCover: photos.length === 0');
    expect(photos).toContain('/photos/order');
    expect(photos).toContain("Alert.alert(\n      'Remove photo?'");
    expect(photos).toContain("method: 'DELETE'");
  });

  it('keeps one accessible add-photo action after uploads and exposes cover status without color alone', () => {
    const photos = source.slice(
      source.indexOf('function PhotosStep('),
      source.indexOf('function DocumentsStep('),
    );

    expect(photos).toContain('name="star"');
    expect(photos).toContain('>Cover</Text>');
    expect(photos).toContain('accessibilityHint="Choose the camera or photo library"');
    expect(photos).toContain('accessibilityRole="button"');
    expect(photos).toContain("uploading ? 'Uploading…' : 'Add photo'");
    expect(photos).not.toContain('label="Upload photo"');
    expect(photos).not.toContain('label="Take photo"');
  });

  it('renders the server-owned document checklist with accurate required completion', () => {
    const documents = source.slice(
      source.indexOf('function DocumentsStep('),
      source.indexOf('function LocationStep('),
    );

    expect(documents).toContain('`${referenceBase}/document-definitions`');
    expect(documents).toContain('definitions.data?.map((definition) =>');
    expect(documents).toContain("definition.required ? 'Required' : 'Optional'");
    expect(documents).toContain('definitions.data?.filter(({ required }) => required)');
    expect(documents).toContain('activeDefinitionIds.has(definitionId)');
    expect(documents).toContain(
      '{addedRequiredCount} of {requiredDefinitions.length} required added',
    );
  });

  it('uses one accessible add-document action with the existing camera and file sources', () => {
    const documents = source.slice(
      source.indexOf('function DocumentsStep('),
      source.indexOf('function LocationStep('),
    );

    expect(documents).toContain('style={styles.documentEmptyRow}');
    expect(documents).toContain('accessibilityLabel={`Add ${definition.name}`}');
    expect(documents).toContain('>Add document</Text>');
    expect(documents).toContain("text: 'Take photo'");
    expect(documents).toContain("text: 'Choose file'");
    expect(documents).toContain("type: ['application/pdf', 'image/*']");
    expect(documents).not.toContain("label={present ? 'Retake' : 'Take photo'}");
    expect(documents).not.toContain("label={present ? 'Replace file' : 'Choose file'}");
  });

  it('shows a compact completed document state and preserves explicit versioned replacement', () => {
    const documents = source.slice(
      source.indexOf('function DocumentsStep('),
      source.indexOf('function LocationStep('),
    );

    expect(documents).toContain('style={styles.documentAddedRow}');
    expect(documents).toContain("uploading ? 'Replacing…' : 'Added'");
    expect(documents).toContain('document.fileAsset.originalName');
    expect(documents).toContain('name="ellipsis-horizontal"');
    expect(documents).toContain("text: 'Replace document'");
    expect(documents).toContain('replacesDocumentId: current.id');
    expect(documents).not.toContain("method: 'DELETE'");
    expect(documents).not.toContain("text: 'Remove document'");
  });

  it('preserves sensitive upload payload, loading protection, and draft persistence', () => {
    const documents = source.slice(
      source.indexOf('function DocumentsStep('),
      source.indexOf('function LocationStep('),
    );

    expect(documents).toContain("apiClient.upload<SafeFile>('/files', 'SENSITIVE'");
    expect(documents).toContain('definitionId: definition.id');
    expect(documents).toContain('fileAssetId: file.id');
    expect(documents).toContain("method: 'POST'");
    expect(documents).toContain('disabled={uploading}');
    expect(documents).toContain("uploading ? 'Uploading…' : 'Not added'");
    expect(documents).toContain('onSaved();');
  });

  it('uses compact token-based document spacing and scopes the denser footer to Step 4', () => {
    expect(source).toContain('step === 3 && styles.documentEditorActions');
    expect(source).toContain(
      'documentEditorActions: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm }',
    );
    expect(source).toContain(
      'documentCardOptional: { backgroundColor: colors.surface, borderColor: colors.border }',
    );
    expect(source).toContain('minHeight: 52');
    expect(source).toContain('documentsIntro: { gap: spacing.xxs }');
  });

  it('makes photo wizard navigation explicit, validated, and duplicate-safe', () => {
    expect(source).toContain('setSelectedStep(Math.max(0, step - 1))');
    expect(source).toContain('if (continueDraft.isPending) return;');
    expect(source).toContain('step === 2 && value.photos.length < 5');
    expect(source).toContain('more required vehicle photo');
    expect(source).toContain('onPress={continueEditor}');
  });

  it('opens a read-only fleet detail before edit mode', () => {
    expect(source).toContain('function VehicleDetail');
    expect(source).toContain('<View style={styles.vehicleEditAction}>');
    expect(source).toContain('<DetailAction label="Edit vehicle" onPress={() => onEdit()} />');
    expect(source).toContain('vehicleEditAction: { marginTop: spacing.sm }');
    expect(source).toContain('Registration & verification');
    expect(source).toContain('title="Pricing"');
    expect(source).toContain('title="Handover & usage"');
    expect(source).toContain('label="Manage availability"');
    expect(source).toContain('title="Private pickup location"');
    expect(source).toContain('ownerPrivateLocationLabel(value.location)');
    expect(source).toContain('<DetailAction label="Change location" onPress={() => onEdit(4)}');
    expect(source).toContain('title="Known vehicle issues"');
    expect(source).toContain('label="Manage issues"');
  });

  it('keeps the vehicle-detail Back control sticky above its scroll surface', () => {
    const detail = source.slice(
      source.indexOf('function VehicleDetail('),
      source.indexOf('function VehicleDetailSection('),
    );
    const header = detail.indexOf('<View style={styles.vehicleDetailHeader}>');
    const back = detail.indexOf('<BackControl label="Back" onPress={onClose} />', header);
    const scroll = detail.indexOf(
      '<ScrollView contentContainerStyle={[styles.page, styles.vehicleDetailPage]}>',
      back,
    );
    expect(header).toBeGreaterThan(0);
    expect(back).toBeGreaterThan(header);
    expect(scroll).toBeGreaterThan(back);
    expect(detail.slice(scroll)).not.toContain('<BackControl label="Fleet" onPress={onClose} />');
    expect(source).toContain('vehicleDetailHeader: {');
    expect(source).toContain('vehicleDetailPage: { paddingTop: spacing.sm }');
    expect(source).toContain('backgroundColor: colors.background');
  });

  it('aligns vehicle metadata with the status badge in one responsive row', () => {
    expect(source).toContain('<View style={styles.vehicleMetaRow}>');
    expect(source).toContain('<Text style={[styles.body, styles.vehicleMetaText]}>');
    expect(source).toContain("justifyContent: 'space-between'");
    expect(source).toContain('vehicleMetaText: { flex: 1, minWidth: 0 }');
  });

  it('presents a compact management overview without changing vehicle authorities', () => {
    const detail = source.slice(
      source.indexOf('function VehicleDetail('),
      source.indexOf('function VehicleDetailSection('),
    );

    expect(detail).toContain('style={styles.hero}');
    expect(detail).toContain('vehicleStatusLabel(value.status)');
    for (const title of [
      'Vehicle overview',
      'Registration & verification',
      'Private pickup location',
      'Pricing',
      'Handover & usage',
      'Known vehicle issues',
      'Marketplace & availability',
    ]) {
      expect(detail).toContain(`title="${title}"`);
    }
    expect(detail).toContain('label="Transmission"');
    expect(detail).toContain('label="Powertrain"');
    expect(detail).toContain('label="Color"');
    expect(detail).toContain('label="Seats"');
    expect(detail).toContain('`${activeDocuments.length} attached`');
    expect(detail).toContain("value.plateNumber ?? 'Not set'");
  });

  it('keeps private location display safe and all detail actions correctly routed', () => {
    const detail = source.slice(
      source.indexOf('function VehicleDetail('),
      source.indexOf('function VehicleDetailSection('),
    );

    expect(detail).toContain('`${value.location.city}, ${value.location.province}`');
    expect(detail).toContain('ownerPrivateLocationLabel(value.location)');
    expect(detail).not.toContain('value.location.latitude');
    expect(detail).not.toContain('value.location.longitude');
    expect(detail).toContain('onPress={() => onEdit(4)}');
    expect(detail).toContain('onPress={() => onEdit(5)}');
    expect(detail).toContain('onPress={() => onEdit(6)}');
    expect(detail).toContain('onPress={() => setManagingKnownIssues(true)}');
    expect(detail).toContain('onPress={() => setManagingAvailability(true)}');
  });

  it('summarizes pricing, handover, issues, marketplace, and availability from current data', () => {
    const detail = source.slice(
      source.indexOf('function VehicleDetail('),
      source.indexOf('function VehicleDetailSection('),
    );

    expect(detail).toContain('money(policy.dailyRateMinor)');
    expect(detail).toContain("discountsEnabled ? 'Enabled' : 'Not enabled'");
    expect(detail).toContain("? 'Required'");
    expect(detail).toContain("? 'Renter pickup'");
    expect(detail).toContain("? 'Owner delivery'");
    expect(detail).toContain("? 'Renter return'");
    expect(detail).toContain("? 'Owner collection'");
    expect(detail).toContain("policy.mileagePolicy === 'UNLIMITED'");
    expect(detail).toContain('policy.includedKilometersPerDay');
    expect(detail).toContain(".join(' · ')");
    expect(detail).toContain('`${policy.turnaroundMinutes / 60} hours`');
    expect(detail).toContain('{activeIssues.length} active');
    expect(detail).toContain('ownerMarketplaceStatus(value)');
    expect(detail).toContain('ownerMarketplaceExplanation(value)');
    expect(detail).toContain('availabilityTodayLabel(value.availabilityToday)');
    expect(detail).toContain('availabilityTodayDetail(value.availabilityToday)');
    expect(detail).toContain("value.status === 'APPROVED'");
  });

  it('uses one compact white surface and stacked summaries across vehicle-detail sections', () => {
    const section = source.slice(
      source.indexOf('function VehicleDetailSection('),
      source.indexOf('function VehicleDetailRow('),
    );
    const styles = source.slice(source.indexOf('vehicleDetailSection: {'));

    expect(section).toContain('styles.vehicleDetailSection');
    expect(section).toContain('<View style={styles.vehicleDetailSectionContent}>{children}</View>');
    expect(styles).toContain('backgroundColor: colors.surface');
    expect(styles).toContain('borderColor: colors.border');
    expect(styles).toContain('borderRadius: radius.md');
    expect(source).toContain('function VehicleDetailSummary(');
    expect(source).toContain('accessibilityLabel="Private pickup location"');
    expect(source).toContain('<Text style={styles.privateLabelText}>Private</Text>');
  });

  it('renders an advisory Danger zone backed by server revalidation and explicit confirmation', () => {
    const detail = source.slice(
      source.indexOf('function VehicleDetail('),
      source.indexOf('function KnownIssuesManager('),
    );

    expect(detail).toContain("queryKey: ['vehicle-delete-eligibility', id]");
    expect(detail).toContain('`/owner/vehicles/${id}/delete-eligibility`');
    expect(detail).toContain("method: 'DELETE'");
    expect(detail).toContain('body: JSON.stringify(input)');
    expect(detail).toContain('Danger zone');
    expect(detail).toContain('Remove vehicle?');
    expect(detail).toContain("style: 'destructive'");
    expect(detail).toContain('deleteEligibility.data?.allowed !== true');
    expect(detail).toContain('onSuccess: onRemoved');
    expect(source).toContain("void client.invalidateQueries({ queryKey: ['vehicles'] })");
  });

  it('collects an accessible structured removal reason before destructive confirmation', () => {
    const detail = source.slice(
      source.indexOf('function VehicleDetail('),
      source.indexOf('function KnownIssuesManager('),
    );
    const sheet = source.slice(
      source.indexOf('function VehicleRemovalReasonSheet('),
      source.indexOf('function vehicleDeleteBlockerMessage('),
    );

    for (const reason of [
      'SOLD_VEHICLE',
      'NO_LONGER_RENTING',
      'VEHICLE_UNAVAILABLE',
      'MAINTENANCE_OR_REPAIRS',
      'REPLACING_VEHICLE',
      'CARSHARE_EXPERIENCE',
      'OTHER',
    ])
      expect(source).toContain(`VehicleRemovalReason.${reason}`);
    expect(detail).toContain('setRemovalReasonOpen(true)');
    expect(detail.indexOf('setRemovalReasonOpen(true)')).toBeGreaterThan(
      detail.indexOf('deleteEligibility.data?.allowed !== true'),
    );
    expect(sheet).toContain('Why are you removing this vehicle?');
    expect(sheet).toContain('<BackControl label="Back" onPress={close} />');
    expect(sheet).not.toContain('<Button label="Cancel"');
    expect(sheet).toContain('accessibilityRole="radiogroup"');
    expect(sheet).toContain('accessibilityRole="radio"');
    expect(sheet).toContain('accessibilityState={{ checked: selected }}');
    expect(sheet).toContain('disabled={!reason}');
    expect(sheet).toContain('reason === VehicleRemovalReason.OTHER');
    expect(sheet).toContain('accessibilityLabel="Tell us more"');
    expect(sheet).toContain('maxLength={VEHICLE_REMOVAL_OTHER_REASON_MAX_LENGTH}');
    expect(sheet).toContain('adaptiveSheetLayout({');
    expect(sheet).toContain(
      'onContentSizeChange={(_width, height) => setMeasuredContentHeight(height)}',
    );
    expect(sheet).toContain('scrollEnabled={measuredLayout.scrollEnabled}');
    expect(sheet).toContain('presentationStyle="overFullScreen"');
    expect(sheet).toContain("automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}");
    expect(sheet).toContain("behavior={Platform.OS === 'ios' ? 'padding' : undefined}");
    expect(sheet).toContain('<Button disabled={!reason} label="Continue"');
    expect(sheet).toContain('onPress={continueRemoval}');
    expect(detail).toContain("Alert.alert(\n            'Remove vehicle?'");
    expect(detail).toContain('removeVehicle.mutate({ reason');
  });

  it('persists multiple known issues with explicit validation and resolution history', () => {
    expect(source).toContain("queryKey: ['vehicle-known-issues', id]");
    expect(source).toContain("/known-issues${editingId ? `/${editingId}` : ''}");
    expect(source).toContain('Please enter at least 3 characters.');
    expect(source).toContain("save.isPending ? 'Saving…' : 'Save issue'");
    expect(source).toContain('Has this issue been fixed or is it no longer present?');
    expect(source).toContain("status === 'ACTIVE'");
    expect(source).toContain("status === 'RESOLVED'");
    expect(source).toContain('+ Add another issue');
  });

  it('keeps the known-issues manager keyboard-safe and reuses secure inspection photo UX', () => {
    expect(source).toContain('<KeyboardAvoidingView style={styles.flex}>');
    expect(source).toContain("automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}");
    expect(source).toContain('keyboardDismissMode={formKeyboardDismissMode}');
    expect(source).toContain('{ paddingBottom: keyboardAwareBottomPadding }');
    expect(source).toContain("Keyboard.addListener('keyboardDidShow'");
    expect(source).toContain('measureInWindow((_x, y, _width, height)');
    expect(source).toContain('endCoordinates.screenY');
    expect(source).toContain('scrollOffsetY.current + overlap');
    expect(source).toContain('<SecureCameraPhotoSlot');
    expect(source).toContain('name="Add photo"');
    expect(source).toContain('captureLabel="Add photo"');
    expect(source).toContain('hideHeader');
    expect(source).toContain('compactRemoveOverlay');
    expect(securePhotoSlotSource).toContain('label="Remove photo"');
    expect(source).toContain('evidence.length < 10');
    expect(source).toContain("apiClient.upload<SafeFile>('/files', 'SENSITIVE'");
  });

  it('explains issue severity and hides empty resolved history', () => {
    expect(source).toContain(
      'Appearance-only damage that does not affect normal vehicle operation',
    );
    expect(source).toContain('requires review before the vehicle can be rented');
    expect(source).toContain('The vehicle cannot be rented until this issue is resolved');
    expect(source).toContain('options={knownIssueCategoryOptions}');
    expect(source).toContain('options={knownIssueAreaOptions}');
    expect(source).toContain('options={knownIssueClassificationOptions}');
    expect(source).toContain('styles.knownIssueActions');
    expect(source).toContain('styles.knownIssueCardActions');
    expect(source).toContain('scrollToFormAfterLayout.current = true');
    expect(source).toContain('resolved.length > 0 ?');
    expect(source).toContain('Resolved issues ({resolved.length})');
    expect(source).not.toContain('<Text style={styles.title}>Resolved</Text>');
  });

  it('keeps availability in vehicle detail and live-refreshes transitional review states', () => {
    const stepList = source.slice(source.indexOf('const steps = ['), source.indexOf('] as const;'));
    expect(stepList).not.toContain("'Availability'");
    expect(source).toContain('transitionalVehicleStatuses');
    expect(source).toContain('refetchInterval: (query)');
    expect(source).toContain('refetchOnWindowFocus: true');
    expect(source).toContain('Owner-blocked today');
    expect(source).toContain('Booked today');
    expect(source).toContain("timeZone: 'Asia/Manila'");
    expect(source).toContain("queryKey: ['owner-vehicle-dashboard-summary']");
  });

  it('lets owners configure fulfillment through the immutable policy-version flow', () => {
    expect(source).toContain('label="Edit handover & usage"');
    expect(source).toContain('onPress={() => onEdit(6)}');
    expect(source).toContain("label: 'Renter pickup'");
    expect(source).toContain("label: 'Owner delivery'");
    expect(source).toContain("label: 'Renter return'");
    expect(source).toContain("label: 'Owner collection'");
    expect(source).toContain('/policy-versions');
    expect(source).toContain('fulfillmentServiceRadiusMeters: radiusMeters');
    expect(source).toContain('fulfillmentMinimumNoticeMinutes: ownerService ? minimumNotice : 0');
  });

  it('keeps security deposit policy semantics while using compact conditional controls', () => {
    expect(source).toContain('function DepositRequirementSelector');
    expect(source).toContain("{ label: 'No deposit', value: 'NO_DEPOSIT' }");
    expect(source).toContain("{ label: 'Require deposit', value: 'REQUIRE_DEPOSIT' }");
    expect(primitivesSource).toContain('accessibilityState={{ checked: selected }}');
    expect(primitivesSource).toContain('minHeight: 44');
    expect(source).toContain('{securityDepositRequired && (');
    expect(source).toContain('<DepositTierSelector');
    expect(source).toContain('options={allowedDepositTiers.map((amountMinor) => ({');
    expect(source).toContain('allowedTiersByCurrency[selectedDepositCurrency]');
    expect(source).toContain('securityDepositRequired: depositRequiredForPayload');
    expect(source).toContain('securityDepositAmountMinor: depositAmountForPayload');
    expect(source).toContain('securityDepositCurrency: depositCurrencyForPayload');
    expect(source).toContain('Changes apply to new booking requests only.');
    expect(source).toContain('Deposit processing isn’t active yet.');
  });

  it('uses safe defaults, conditional service controls, and friendly validation', () => {
    expect(source).toContain('current?.supportsRenterPickup ?? true');
    expect(source).toContain('current?.supportsOwnerDelivery ?? false');
    expect(source).toContain('current?.supportsRenterReturn ?? true');
    expect(source).toContain('current?.supportsOwnerCollection ?? false');
    expect(source).toContain('Choose at least one way for renters to receive the car.');
    expect(source).toContain('Choose at least one way for the car to be returned.');
    expect(source).toContain('{ownerService && (');
    expect(source).toContain('[5, 10, 15, 25, 50]');
    expect(source).toContain("[10080, '7 days']");
    expect(source).toContain('Delivery & collection');
    expect(source).toContain('How far you’re willing to');
    expect(source).toContain("? 'deliver or collect'");
    expect(source).toContain('Minimum notice');
    expect(source).toContain('How far in advance renters must book owner delivery or collection.');
    expect(source).toContain('and return aren’t affected.');
    expect(source).toContain('{ownerDelivery && (');
    expect(source).toContain('{ownerCollection && (');
  });

  it('organizes Step 7 into progressive, accessible policy sections', () => {
    const policy = source.slice(
      source.indexOf('function PolicyStep('),
      source.indexOf('function AvailabilityStep('),
    );

    for (const heading of [
      'Handover',
      'Delivery & collection',
      'Mileage',
      'Turnaround',
      'Return conditions',
    ]) {
      expect(policy).toContain(heading);
    }
    expect(policy).toContain('<PolicyOptionGroup');
    expect(source).toContain("accessibilityRole={exclusive ? 'radio' : 'checkbox'}");
    expect(source).toContain('accessibilityState={{ checked: option.selected }}');
    expect(policy).toContain('{ownerService && (');
    expect(policy).toContain('{limited && (');
    expect(policy).toContain("const electric = vehicle.powertrain === 'BATTERY_ELECTRIC'");
    expect(policy).toContain("electric ? 'EV charge' : 'Fuel'");
  });

  it('uses one compact accessible choice treatment for radius, notice, and turnaround', () => {
    const policy = source.slice(
      source.indexOf('function PolicyStep('),
      source.indexOf('function AvailabilityStep('),
    );
    const compactChoice = source.slice(
      source.indexOf('function CompactPolicyChoice('),
      source.indexOf('function PolicyNumberField('),
    );

    expect(policy.match(/<CompactPolicyChoice/g)).toHaveLength(3);
    expect(policy).toContain('[5, 10, 15, 25, 50]');
    expect(policy).toContain("[10080, '7 days']");
    expect(policy).toContain('[120, 240, 360, 720, 1440]');
    expect(compactChoice).toContain('accessibilityRole="radio"');
    expect(compactChoice).toContain('accessibilityState={{ checked: selected, selected }}');
    expect(source).toContain('compactPolicyChoiceHitArea:');
    expect(source).toContain('minHeight: 44');
    expect(source).toContain('height: 34');
  });

  it('keeps hidden owner-service values in session and preserves the policy payload', () => {
    const policy = source.slice(
      source.indexOf('function PolicyStep('),
      source.indexOf('function AvailabilityStep('),
    );

    expect(policy).toContain('const [serviceRadiusKm, setServiceRadiusKm] = useState(');
    expect(policy).toContain('const [deliveryFee, setDeliveryFee] = useState(');
    expect(policy).toContain('const [collectionFee, setCollectionFee] = useState(');
    expect(policy).not.toContain("setServiceRadiusKm('')");
    expect(policy).not.toContain("setDeliveryFee('')");
    expect(policy).not.toContain("setCollectionFee('')");
    expect(policy).toContain('supportsRenterPickup: renterPickup');
    expect(policy).toContain('supportsOwnerDelivery: ownerDelivery');
    expect(policy).toContain('supportsRenterReturn: renterReturn');
    expect(policy).toContain('supportsOwnerCollection: ownerCollection');
    expect(policy).toContain(
      "if (mode === 'usage') await markSectionComplete(endpointBase, 'Policies')",
    );
  });

  it('keeps every long-booking field in the dedicated pricing step', () => {
    const policy = source.slice(
      source.indexOf('function PolicyStep('),
      source.indexOf('function DiscountRow('),
    );
    const discountRow = source.slice(
      source.indexOf('function DiscountRow('),
      source.indexOf('function DepositRequirementSelector('),
    );
    const shortTier = policy.indexOf('label="3+ days"');
    const weeklyTier = policy.indexOf('label="7+ days"');
    const extendedTier = policy.indexOf('label="14+ days"');
    const monthlyTier = policy.indexOf('label="30+ days"');

    expect(policy).toContain('Long-booking discounts');
    expect(policy).toContain(
      'Enter 0–40%. Longer stays can’t have a lower discount than shorter stays.',
    );
    expect(policy).toContain('Longer-stay discounts can’t be lower than shorter-stay discounts.');
    expect(policy).toContain("mode === 'pricing'");
    expect(shortTier).toBeLessThan(weeklyTier);
    expect(weeklyTier).toBeLessThan(extendedTier);
    expect(extendedTier).toBeLessThan(monthlyTier);
    expect(discountRow).toContain('accessibilityLabel={`${label} discount percentage`}');
    expect(discountRow).toContain('style={styles.discountSuffix}');
  });

  it('progressively reveals discounts without adding a backend toggle field', () => {
    const policy = source.slice(
      source.indexOf('function PolicyStep('),
      source.indexOf('function AvailabilityStep('),
    );

    expect(policy).toContain('const [discountsEnabled, setDiscountsEnabled] = useState(');
    expect(policy).toContain('].some((value) => (value ?? 0) > 0)');
    expect(policy).toContain('accessibilityLabel="Offer long-booking discounts"');
    expect(policy).toContain('accessibilityRole="switch"');
    expect(policy).toContain('accessibilityState={{ checked: discountsEnabled }}');
    expect(policy).toContain('setDiscountsEnabled(enabled);');
    expect(policy).toContain('{discountsEnabled && (');
    expect(policy).toContain('discountsEnabled && shortDiscount.trim()');
    expect(policy).toContain('discountsEnabled && weeklyDiscount.trim()');
    expect(policy).toContain('discountsEnabled && extendedDiscount.trim()');
    expect(policy).toContain('discountsEnabled && monthlyDiscount.trim()');
    expect(policy).not.toContain('discountsEnabled:');
    expect(policy).not.toContain('setShortDiscount(');
    expect(policy).not.toContain('setWeeklyDiscount(');
    expect(policy).not.toContain('setExtendedDiscount(');
    expect(policy).not.toContain('setMonthlyDiscount(');
    expect(policy).toContain('discount < 0 || discount > 40');
    expect(policy).toContain('discount < previousDiscount');
    expect(policy).toContain("if (!enabled) setDiscountError('');");
    expect(policy).toContain('{discountError && (');
  });

  it('explains authoritative per-day mileage and whole-kilometer excess fees conditionally', () => {
    expect(source).toContain('label="Included distance"');
    expect(source).toContain('suffix="km/day"');
    expect(source).toContain('label="Excess distance fee"');
    expect(source).toContain('suffix="/ km"');
    expect(source).toContain('Extra whole kilometers are charged at the rate above.');
    expect(source.indexOf('label="Included distance"')).toBeLessThan(
      source.indexOf('label="Excess distance fee"'),
    );
    expect(source).toContain('{limited && (');
    expect(source).toContain('current?.includedKilometersPerDay ?? 150');
    expect(source).toContain('current?.excessKilometerRateMinor ?? 1500');
  });

  it('preserves unrelated latest policy values and explains marketplace lifecycle', () => {
    expect(source).toContain('minimumRentalDays: current?.minimumRentalDays ?? 1');
    expect(source).toContain('availabilityPolicy: current?.availabilityPolicy ??');
    expect(source).toContain('fuelReturnPolicy: current?.fuelReturnPolicy ??');
    expect(source).toContain('title="Marketplace & availability"');
    expect(source).toContain('CarShare Operations must approve this vehicle');
    expect(source).toContain('apiClient.request(`/owner/vehicles/${id}/operational-status`');
    expect(source).toContain("? 'Mark temporarily unavailable'");
    expect(source).toContain(": 'Mark available'");
    expect(source).not.toContain('Available for search');
  });

  it('uses server capabilities for delegated proposal entry points', () => {
    expect(source).toContain('value.capabilities?.canAddKnownIssue');
    expect(source).toContain('value.capabilities?.canEditHandoverUsage');
    expect(source).toContain('value.capabilities?.canEditMarketplaceAvailability');
    expect(source).toContain('value.capabilities?.canEditVehicleConfiguration');
    expect(source).toContain('label="Edit handover & usage"');
    expect(source).toContain('label="Edit marketplace settings"');
  });

  it('uses a dedicated constrained Known Issue flow for Operational Staff', () => {
    expect(source).toContain("ownerWorkspace.capacity === 'STAFF' ? (");
    expect(source).toContain('<StaffKnownIssueProposalEditor');
    const staffEditor = source.slice(
      source.indexOf('function StaffKnownIssueProposalEditor('),
      source.indexOf('function ManagerVehicleProposalEditor('),
    );
    expect(staffEditor).toContain('<Text style={styles.title}>Add known issue</Text>');
    expect(staffEditor).toContain('Send to Owner for approval');
    expect(staffEditor).toContain('knownIssues: [');
    expect(staffEditor).toContain(".filter(({ id }) => id !== null)");
    expect(staffEditor).not.toContain('<PhotosStep');
    expect(staffEditor).not.toContain('<DocumentsStep');
    expect(staffEditor).not.toContain('Pricing & rental policy');
    expect(source).toContain("hasOwnerPermission(ownerWorkspace, 'known_issues.create')");
    expect(source).toContain('const workspaceActorKey = ownerWorkspace.membershipId');
  });

  it('does not leave proposal initialization errors behind a loading state', () => {
    const staffEditor = source.slice(
      source.indexOf('function StaffKnownIssueProposalEditor('),
      source.indexOf('function ManagerVehicleProposalEditor('),
    );
    expect(staffEditor.indexOf('if (proposal.isError)')).toBeLessThan(
      staffEditor.indexOf('if (proposal.isPending || !proposal.data)'),
    );
    expect(staffEditor).toContain('actionLabel="Retry"');
    expect(staffEditor).toContain('Vehicle changes are already being prepared');
  });
});
