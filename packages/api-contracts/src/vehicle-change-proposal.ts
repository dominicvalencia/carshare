export const VEHICLE_CHANGE_PROPOSAL_SNAPSHOT_VERSION = 1 as const;

const knownIssueCategories = [
  'SCRATCH',
  'DENT',
  'CRACK',
  'PAINT_DAMAGE',
  'WHEEL_OR_RIM',
  'TIRE',
  'GLASS',
  'INTERIOR',
  'WARNING_LIGHT',
  'MECHANICAL_OR_OPERATIONAL',
  'OTHER',
] as const;
const knownIssueVehicleAreas = [
  'FRONT_BUMPER',
  'REAR_BUMPER',
  'DRIVER_SIDE',
  'PASSENGER_SIDE',
  'WINDSHIELD',
  'WHEEL_OR_TIRE',
  'INTERIOR',
  'DASHBOARD',
  'OTHER',
] as const;

export type VehicleChangeProposalStatus =
  | 'DRAFT'
  | 'PENDING_OWNER_APPROVAL'
  | 'OWNER_CHANGES_REQUIRED'
  | 'PENDING_PLATFORM_REVIEW'
  | 'PLATFORM_CHANGES_REQUIRED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'APPLIED'
  | 'SUPERSEDED';

export type VehicleChangeProposalKind = 'GENERAL' | 'STAFF_KNOWN_ISSUE';

export type VehicleChangeClassification = 'OWNER_APPROVAL_ONLY' | 'PLATFORM_REVIEW_REQUIRED';

export type VehicleChangeField =
  | 'vehicle.category'
  | 'vehicle.make'
  | 'vehicle.model'
  | 'vehicle.variant'
  | 'vehicle.year'
  | 'vehicle.transmission'
  | 'vehicle.powertrain'
  | 'vehicle.fuelType'
  | 'vehicle.seats'
  | 'vehicle.doors'
  | 'vehicle.color'
  | 'vehicle.plate'
  | 'vehicle.vin'
  | 'vehicle.description'
  | 'vehicle.rentalRequirements'
  | 'features'
  | 'photos'
  | 'documents'
  | 'documents.registration'
  | 'documents.insurance'
  | 'documents.ownership'
  | 'knownIssues'
  | 'location'
  | `policy.${string}`;

export interface VehicleChangeProposalSnapshotV1 {
  readonly schemaVersion: 1;
  readonly vehicle: {
    readonly categoryId: string | null;
    readonly make: string | null;
    readonly model: string | null;
    readonly variant: string | null;
    readonly modelYear: number | null;
    readonly transmission: string | null;
    readonly powertrain: string | null;
    readonly fuelType: string | null;
    readonly seatCount: number | null;
    readonly doorCount: number | null;
    readonly color: string | null;
    readonly plateNumber: string | null;
    readonly vin: string | null;
    readonly description: string | null;
    readonly rentalRequirements: string | null;
  };
  readonly featureIds: readonly string[];
  readonly photos: readonly {
    readonly fileAssetId: string;
    readonly perspective: string;
    readonly displayOrder: number;
    readonly isCover: boolean;
  }[];
  readonly documents: readonly {
    readonly definitionId: string;
    readonly documentType: string;
    readonly fileAssetId: string;
    readonly expiresAt: string | null;
  }[];
  readonly knownIssues?: readonly {
    readonly id: string | null;
    readonly category: string;
    readonly vehicleArea: string;
    readonly classification: string;
    readonly description: string;
    readonly status: 'ACTIVE' | 'RESOLVED';
  }[];
  readonly location: {
    readonly latitude: string;
    readonly longitude: string;
    readonly city: string;
    readonly province: string;
    readonly country: string;
    readonly timezone: string;
    readonly pickupAreaLabel: string | null;
    readonly regionCode: string | null;
    readonly addressScopeCode: string | null;
    readonly provinceCode: string | null;
    readonly cityMunicipalityCode: string | null;
    readonly barangayCode: string | null;
    readonly barangay: string | null;
    readonly addressLine1: string | null;
    readonly landmark: string | null;
  } | null;
  readonly policy: {
    readonly currency: string;
    readonly dailyRateMinor: number;
    readonly shortDurationDiscountBps: number | null;
    readonly weeklyDiscountBps: number | null;
    readonly extendedTripDiscountBps: number | null;
    readonly monthlyDiscountBps: number | null;
    readonly minimumRentalDays: number;
    readonly maximumRentalDays: number;
    readonly mileagePolicy: string;
    readonly includedKilometersPerDay: number | null;
    readonly excessKilometerRateMinor: number | null;
    readonly fuelReturnPolicy: string | null;
    readonly fuelTolerancePercent: number | null;
    readonly fuelCalculationPolicyRef: string | null;
    readonly evReturnPolicy: string | null;
    readonly evRequiredPercentage: number | null;
    readonly evTolerancePercent: number | null;
    readonly evCalculationPolicyRef: string | null;
    readonly turnaroundMinutes: number;
    readonly availabilityPolicy: string;
    readonly monday: boolean;
    readonly tuesday: boolean;
    readonly wednesday: boolean;
    readonly thursday: boolean;
    readonly friday: boolean;
    readonly saturday: boolean;
    readonly sunday: boolean;
    readonly supportsRenterPickup: boolean;
    readonly supportsOwnerDelivery: boolean;
    readonly supportsRenterReturn: boolean;
    readonly supportsOwnerCollection: boolean;
    readonly fulfillmentServiceRadiusMeters: number | null;
    readonly deliveryFeeMinor: number | null;
    readonly collectionFeeMinor: number | null;
    readonly fulfillmentMinimumNoticeMinutes: number;
    readonly securityDepositRequired: boolean;
    readonly securityDepositAmountMinor: number | null;
    readonly securityDepositCurrency: string | null;
  };
}

export interface UpdateVehicleChangeProposalRequest {
  readonly proposedSnapshot: VehicleChangeProposalSnapshotV1;
}

export interface VehicleChangeProposalReadModel {
  readonly id: string;
  readonly vehicleId: string;
  readonly status: VehicleChangeProposalStatus;
  readonly kind: VehicleChangeProposalKind;
  readonly baseVehicleRevision: number;
  readonly snapshotSchemaVersion: number;
  readonly proposedSnapshot: VehicleChangeProposalSnapshotV1;
  readonly changedFields: readonly VehicleChangeField[];
  readonly classification: VehicleChangeClassification;
  readonly platformReviewRequired: boolean;
  readonly ownerApprovalRequired: boolean;
  readonly ownerApprovalBypassed: boolean;
  readonly submitter: {
    readonly displayName: string;
  };
  readonly assets: readonly {
    readonly contentGrant?: {
      readonly contentPath: string;
      readonly expiresAt: string | Date;
      readonly grant: string;
    };
    readonly documentDefinitionId?: string | null;
    readonly documentType?: string | null;
    readonly expiresAt?: string | null;
    readonly fileAssetId: string;
    readonly kind: 'PHOTO' | 'DOCUMENT';
    readonly mimeType?: string;
    readonly originalName?: string;
  }[];
  readonly createdAt: string;
  readonly submittedAt: string | null;
  readonly updatedAt: string;
  readonly withdrawnAt: string | null;
  readonly platformReviewReason?: string | null;
}

export interface AdminVehicleChangeProposalListItem {
  readonly id: string;
  readonly vehicleId: string;
  readonly vehicle: { readonly displayName: string };
  readonly workspace: { readonly id: string; readonly name: string };
  readonly submitter: { readonly displayName: string };
  readonly changedFields: readonly VehicleChangeField[];
  readonly classification: VehicleChangeClassification;
  readonly status: VehicleChangeProposalStatus;
  readonly submittedAt: string | null;
  readonly stale: boolean;
}

export interface AdminVehicleChangeProposalListResponse {
  readonly proposals: readonly AdminVehicleChangeProposalListItem[];
}

export interface AdminVehicleChangeProposalDetail extends AdminVehicleChangeProposalListItem {
  readonly baseVehicleRevision: number;
  readonly currentVehicleRevision: number;
  readonly currentSnapshot: VehicleChangeProposalSnapshotV1;
  readonly proposedSnapshot: VehicleChangeProposalSnapshotV1;
  readonly ownerApprovalRequired: boolean;
  readonly ownerApprovalBypassed: boolean;
  readonly trustEnabledAtSubmission: boolean;
  readonly platformReviewRequired: boolean;
  readonly ownerReviewedAt: string | null;
  readonly platformReviewedAt: string | null;
  readonly platformReviewReason: string | null;
  readonly appliedAt: string | null;
  readonly assets: readonly {
    readonly fileAssetId: string;
    readonly kind: 'PHOTO' | 'DOCUMENT';
    readonly originalName: string;
    readonly mimeType: string;
    readonly contentGrant: unknown;
  }[];
  readonly reviewHistory: readonly {
    readonly action: string;
    readonly reason: string | null;
    readonly occurredAt: string;
  }[];
}

export interface AdminVehicleChangeProposalDecisionRequest {
  readonly reason: string;
}

export interface AdminVehicleChangeProposalDecisionResponse {
  readonly id: string;
  readonly status: 'APPLIED' | 'PLATFORM_CHANGES_REQUIRED' | 'REJECTED';
  readonly reviewedAt: string;
  readonly resultingVehicleRevision: number;
}

export type CreateVehicleChangeProposalResponse = VehicleChangeProposalReadModel;
export type GetVehicleChangeProposalResponse = VehicleChangeProposalReadModel;
export type UpdateVehicleChangeProposalResponse = VehicleChangeProposalReadModel;

export interface WithdrawVehicleChangeProposalResponse {
  readonly id: string;
  readonly status: 'WITHDRAWN';
  readonly withdrawnAt: string;
}

export interface SubmitVehicleChangeProposalResponse extends VehicleChangeProposalReadModel {
  readonly status: 'PENDING_OWNER_APPROVAL' | 'PENDING_PLATFORM_REVIEW' | 'APPLIED';
  readonly submittedAt: string;
}

export interface OwnerVehicleChangeProposalComparison {
  readonly changedFields: readonly VehicleChangeField[];
  readonly currentSnapshot: VehicleChangeProposalSnapshotV1;
  readonly proposedSnapshot: VehicleChangeProposalSnapshotV1;
}

export interface OwnerVehicleChangeProposalReviewModel {
  readonly id: string;
  readonly vehicleId: string;
  readonly vehicle: {
    readonly make: string | null;
    readonly model: string | null;
    readonly modelYear: number | null;
  };
  readonly currentVehicleRevision: number;
  readonly baseVehicleRevision: number;
  readonly status: VehicleChangeProposalStatus;
  readonly submitter: { readonly displayName: string };
  readonly submittedAt: string | null;
  readonly classification: VehicleChangeClassification;
  readonly platformReviewRequired: boolean;
  readonly assets: VehicleChangeProposalReadModel['assets'];
  readonly comparison: OwnerVehicleChangeProposalComparison;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OwnerVehicleChangeProposalListResponse {
  readonly proposals: readonly OwnerVehicleChangeProposalReviewModel[];
}

export interface OwnerVehicleChangeProposalDecisionResponse {
  readonly id: string;
  readonly status: 'APPLIED' | 'PENDING_PLATFORM_REVIEW' | 'OWNER_CHANGES_REQUIRED';
  readonly reviewedAt: string;
}

export interface OwnerVehicleChangeProposalChangeRequest {
  readonly reason: string;
}

const reviewSensitiveFields = new Set<VehicleChangeField>([
  'vehicle.category',
  'vehicle.make',
  'vehicle.model',
  'vehicle.variant',
  'vehicle.year',
  'vehicle.transmission',
  'vehicle.powertrain',
  'vehicle.fuelType',
  'vehicle.seats',
  'vehicle.doors',
  'vehicle.color',
  'vehicle.plate',
  'vehicle.vin',
  'photos',
  'documents',
  'documents.registration',
  'documents.insurance',
  'documents.ownership',
  'location',
]);

const vehicleFields: readonly [
  keyof VehicleChangeProposalSnapshotV1['vehicle'],
  VehicleChangeField,
][] = [
  ['categoryId', 'vehicle.category'],
  ['make', 'vehicle.make'],
  ['model', 'vehicle.model'],
  ['variant', 'vehicle.variant'],
  ['modelYear', 'vehicle.year'],
  ['transmission', 'vehicle.transmission'],
  ['powertrain', 'vehicle.powertrain'],
  ['fuelType', 'vehicle.fuelType'],
  ['seatCount', 'vehicle.seats'],
  ['doorCount', 'vehicle.doors'],
  ['color', 'vehicle.color'],
  ['plateNumber', 'vehicle.plate'],
  ['vin', 'vehicle.vin'],
  ['description', 'vehicle.description'],
  ['rentalRequirements', 'vehicle.rentalRequirements'],
];

export function classifyVehicleChangedFields(
  fields: readonly VehicleChangeField[],
): VehicleChangeClassification {
  return fields.some((field) => reviewSensitiveFields.has(field))
    ? 'PLATFORM_REVIEW_REQUIRED'
    : 'OWNER_APPROVAL_ONLY';
}

export function diffVehicleChangeProposalSnapshots(
  live: VehicleChangeProposalSnapshotV1,
  proposed: VehicleChangeProposalSnapshotV1,
): VehicleChangeField[] {
  const changed = new Set<VehicleChangeField>();
  for (const [key, field] of vehicleFields) {
    if (live.vehicle[key] !== proposed.vehicle[key]) changed.add(field);
  }
  if (!sameSet(live.featureIds, proposed.featureIds)) changed.add('features');
  if (!sameArray(live.photos, proposed.photos)) changed.add('photos');
  for (const field of diffDocuments(live.documents, proposed.documents)) changed.add(field);
  if (!sameArray(live.knownIssues ?? [], proposed.knownIssues ?? live.knownIssues ?? []))
    changed.add('knownIssues');
  if (!sameRecord(live.location, proposed.location)) changed.add('location');
  for (const key of Object.keys(live.policy).sort() as (keyof typeof live.policy)[]) {
    if (live.policy[key] !== proposed.policy[key]) changed.add(`policy.${key}`);
  }
  return [...changed].sort();
}

export function validateVehicleChangeProposalSnapshotV1(
  snapshot: VehicleChangeProposalSnapshotV1,
): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(snapshot)) return ['Proposal snapshot must be an object.'];
  rejectUnknownKeys(
    snapshot,
    [
      'schemaVersion',
      'vehicle',
      'featureIds',
      'photos',
      'documents',
      'knownIssues',
      'location',
      'policy',
    ],
    'snapshot',
    errors,
  );
  if (
    !isRecord(snapshot.vehicle) ||
    !Array.isArray(snapshot.featureIds) ||
    !Array.isArray(snapshot.photos) ||
    !Array.isArray(snapshot.documents) ||
    !isRecord(snapshot.policy)
  )
    return [...errors, 'Proposal snapshot structure is invalid.'];
  rejectUnknownKeys(
    snapshot.vehicle,
    [
      'categoryId',
      'make',
      'model',
      'variant',
      'modelYear',
      'transmission',
      'powertrain',
      'fuelType',
      'seatCount',
      'doorCount',
      'color',
      'plateNumber',
      'vin',
      'description',
      'rentalRequirements',
    ],
    'vehicle',
    errors,
  );
  rejectUnknownKeys(
    snapshot.policy,
    [
      'currency',
      'dailyRateMinor',
      'shortDurationDiscountBps',
      'weeklyDiscountBps',
      'extendedTripDiscountBps',
      'monthlyDiscountBps',
      'minimumRentalDays',
      'maximumRentalDays',
      'mileagePolicy',
      'includedKilometersPerDay',
      'excessKilometerRateMinor',
      'fuelReturnPolicy',
      'fuelTolerancePercent',
      'fuelCalculationPolicyRef',
      'evReturnPolicy',
      'evRequiredPercentage',
      'evTolerancePercent',
      'evCalculationPolicyRef',
      'turnaroundMinutes',
      'availabilityPolicy',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
      'supportsRenterPickup',
      'supportsOwnerDelivery',
      'supportsRenterReturn',
      'supportsOwnerCollection',
      'fulfillmentServiceRadiusMeters',
      'deliveryFeeMinor',
      'collectionFeeMinor',
      'fulfillmentMinimumNoticeMinutes',
      'securityDepositRequired',
      'securityDepositAmountMinor',
      'securityDepositCurrency',
    ],
    'policy',
    errors,
  );
  for (const photo of snapshot.photos) {
    if (!isRecord(photo)) errors.push('Photo references are invalid.');
    else
      rejectUnknownKeys(
        photo,
        ['fileAssetId', 'perspective', 'displayOrder', 'isCover'],
        'photo',
        errors,
      );
  }
  for (const document of snapshot.documents) {
    if (!isRecord(document)) errors.push('Document references are invalid.');
    else
      rejectUnknownKeys(
        document,
        ['definitionId', 'documentType', 'fileAssetId', 'expiresAt'],
        'document',
        errors,
      );
  }
  if (snapshot.knownIssues !== undefined) {
    if (!Array.isArray(snapshot.knownIssues)) errors.push('Known issues are invalid.');
    else
      for (const issue of snapshot.knownIssues) {
        if (!isRecord(issue)) errors.push('Known issues are invalid.');
        else
          rejectUnknownKeys(
            issue,
            ['id', 'category', 'vehicleArea', 'classification', 'description', 'status'],
            'known issue',
            errors,
          );
      }
  }
  if (snapshot.location !== null) {
    if (!isRecord(snapshot.location)) return [...errors, 'Vehicle location is invalid.'];
    rejectUnknownKeys(
      snapshot.location,
      [
        'latitude',
        'longitude',
        'city',
        'province',
        'country',
        'timezone',
        'pickupAreaLabel',
        'regionCode',
        'addressScopeCode',
        'provinceCode',
        'cityMunicipalityCode',
        'barangayCode',
        'barangay',
        'addressLine1',
        'landmark',
      ],
      'location',
      errors,
    );
  }
  if (snapshot.schemaVersion !== VEHICLE_CHANGE_PROPOSAL_SNAPSHOT_VERSION)
    errors.push('Unsupported snapshot schema version.');
  if (!snapshot.vehicle.make?.trim() || !snapshot.vehicle.model?.trim())
    errors.push('Vehicle make and model are required.');
  if (
    snapshot.vehicle.modelYear !== null &&
    (snapshot.vehicle.modelYear < 1900 || snapshot.vehicle.modelYear > 2100)
  )
    errors.push('Vehicle year is invalid.');
  if (
    snapshot.vehicle.seatCount !== null &&
    (snapshot.vehicle.seatCount < 1 || snapshot.vehicle.seatCount > 20)
  )
    errors.push('Vehicle seat count is invalid.');
  if (
    snapshot.vehicle.doorCount !== null &&
    (snapshot.vehicle.doorCount < 1 || snapshot.vehicle.doorCount > 6)
  )
    errors.push('Vehicle door count is invalid.');
  if (snapshot.vehicle.plateNumber && snapshot.vehicle.plateNumber.length > 30)
    errors.push('Vehicle plate is invalid.');
  if (snapshot.vehicle.vin && snapshot.vehicle.vin.length > 64)
    errors.push('Vehicle VIN is invalid.');
  if (snapshot.policy.dailyRateMinor < 1) errors.push('Daily price must be positive.');
  if (snapshot.policy.currency.toUpperCase() !== 'PHP')
    errors.push('Vehicle pricing must use PHP.');
  if (
    snapshot.policy.minimumRentalDays < 1 ||
    snapshot.policy.maximumRentalDays < snapshot.policy.minimumRentalDays ||
    snapshot.policy.maximumRentalDays > 365
  )
    errors.push('Rental duration policy is invalid.');
  for (const discount of [
    snapshot.policy.shortDurationDiscountBps,
    snapshot.policy.weeklyDiscountBps,
    snapshot.policy.extendedTripDiscountBps,
    snapshot.policy.monthlyDiscountBps,
  ]) {
    if (discount !== null && (discount < 0 || discount > 4000))
      errors.push('Discount policy is invalid.');
  }
  if (
    snapshot.policy.securityDepositRequired !==
    Boolean(snapshot.policy.securityDepositAmountMinor && snapshot.policy.securityDepositCurrency)
  )
    errors.push('Security deposit configuration is invalid.');
  if (![120, 240, 360, 720, 1440].includes(snapshot.policy.turnaroundMinutes))
    errors.push('Turnaround policy is invalid.');
  if (
    snapshot.policy.mileagePolicy === 'LIMITED' &&
    (!snapshot.policy.includedKilometersPerDay || !snapshot.policy.excessKilometerRateMinor)
  )
    errors.push('Limited mileage configuration is invalid.');
  if (
    snapshot.policy.availabilityPolicy === 'WEEKLY' &&
    ![
      snapshot.policy.monday,
      snapshot.policy.tuesday,
      snapshot.policy.wednesday,
      snapshot.policy.thursday,
      snapshot.policy.friday,
      snapshot.policy.saturday,
      snapshot.policy.sunday,
    ].some(Boolean)
  )
    errors.push('Weekly availability is invalid.');
  const electric = snapshot.vehicle.powertrain === 'BATTERY_ELECTRIC';
  if (
    (electric && (!snapshot.policy.evReturnPolicy || snapshot.policy.fuelReturnPolicy)) ||
    (!electric && (!snapshot.policy.fuelReturnPolicy || snapshot.policy.evReturnPolicy))
  )
    errors.push('Fuel or EV return policy is inconsistent with the powertrain.');
  if (
    !snapshot.featureIds.every(isIdentifier) ||
    new Set(snapshot.featureIds).size !== snapshot.featureIds.length
  )
    errors.push('Feature identifiers must be unique UUIDs.');
  if (
    snapshot.photos.some(
      (photo) => !isIdentifier(photo.fileAssetId) || photo.displayOrder < 0 || !photo.perspective,
    ) ||
    snapshot.photos.filter((photo) => photo.isCover).length > 1 ||
    new Set(snapshot.photos.map(({ fileAssetId }) => fileAssetId)).size !== snapshot.photos.length
  )
    errors.push('Photo references are invalid.');
  if (
    snapshot.documents.some(
      (document) =>
        !isIdentifier(document.fileAssetId) ||
        !isIdentifier(document.definitionId) ||
        !document.documentType,
    ) ||
    new Set(snapshot.documents.map(({ fileAssetId }) => fileAssetId)).size !==
      snapshot.documents.length
  )
    errors.push('Document references are invalid.');
  if (snapshot.knownIssues) {
    const identifiedIssues = snapshot.knownIssues.filter(({ id }) => id !== null);
    if (
      snapshot.knownIssues.some(
        (issue) =>
          (issue.id !== null && !isIdentifier(issue.id)) ||
          !knownIssueCategories.includes(issue.category as never) ||
          !knownIssueVehicleAreas.includes(issue.vehicleArea as never) ||
          !['COSMETIC', 'OPERATIONAL', 'SAFETY_CRITICAL'].includes(issue.classification) ||
          !issue.description.trim() ||
          issue.description.length > 1000 ||
          !['ACTIVE', 'RESOLVED'].includes(issue.status),
      ) ||
      new Set(identifiedIssues.map(({ id }) => id)).size !== identifiedIssues.length
    )
      errors.push('Known issues are invalid.');
  }
  if (
    snapshot.location &&
    (!snapshot.location.city.trim() ||
      !snapshot.location.province.trim() ||
      !isCoordinate(snapshot.location.latitude, 90) ||
      !isCoordinate(snapshot.location.longitude, 180))
  )
    errors.push('Vehicle location is invalid.');
  return [...new Set(errors)];
}

export class VehicleChangeProposalStaleError extends Error {
  readonly code = 'VEHICLE_CHANGE_PROPOSAL_STALE';

  constructor() {
    super('The live vehicle changed after this proposal was created.');
  }
}

export function assertVehicleChangeProposalFresh(
  baseVehicleRevision: number,
  currentVehicleRevision: number,
): void {
  if (baseVehicleRevision !== currentVehicleRevision) throw new VehicleChangeProposalStaleError();
}

function isIdentifier(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`Unknown ${path} field: ${key}.`);
  }
}

function isCoordinate(value: string, maximum: number): boolean {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= maximum;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function sameArray(left: readonly unknown[], right: readonly unknown[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => sameRecord(value, right[index]))
  );
}

function sameRecord(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
  return keys.every((key) => sameRecord(leftRecord[key], rightRecord[key]));
}

function normalizeDocuments(documents: VehicleChangeProposalSnapshotV1['documents']) {
  return [...documents].sort((left, right) =>
    `${left.documentType}:${left.definitionId}:${left.fileAssetId}`.localeCompare(
      `${right.documentType}:${right.definitionId}:${right.fileAssetId}`,
    ),
  );
}

function diffDocuments(
  live: VehicleChangeProposalSnapshotV1['documents'],
  proposed: VehicleChangeProposalSnapshotV1['documents'],
): VehicleChangeField[] {
  const types = [...new Set([...live, ...proposed].map(({ documentType }) => documentType))].sort();
  const changed = types.filter(
    (type) =>
      !sameArray(
        normalizeDocuments(live.filter(({ documentType }) => documentType === type)),
        normalizeDocuments(proposed.filter(({ documentType }) => documentType === type)),
      ),
  );
  return changed.map((type) => {
    const normalized = type.trim().toLowerCase();
    return ['registration', 'insurance', 'ownership'].includes(normalized)
      ? (`documents.${normalized}` as VehicleChangeField)
      : 'documents';
  });
}
