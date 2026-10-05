export interface HistorySearchRecord {
  readonly id: string;
  readonly placeLabel: string;
  readonly city: string;
  readonly province: string;
  readonly centerLatitude: number | null;
  readonly centerLongitude: number | null;
  readonly radiusKm: number;
  readonly rentalStart: string | null;
  readonly rentalEnd: string | null;
  readonly criteria: unknown;
  readonly searchedAt: string;
}

export interface ReconstructedSearch {
  readonly title: string;
  readonly query: string;
  readonly location: {
    readonly label: string;
    readonly detail: string;
    readonly city: string;
    readonly province: string;
    readonly latitude: number;
    readonly longitude: number;
  };
  readonly radiusKm: number;
  readonly start: Date | null;
  readonly end: Date | null;
  readonly categoryId: string;
  readonly make: string;
  readonly seats: string;
  readonly transmission: string;
  readonly powertrain: string;
  readonly minPrice: string;
  readonly maxPrice: string;
  readonly handover: string;
  readonly returnHandover: string;
}

export interface ExploreRailCard {
  readonly vehicleId: string;
  readonly make: string | null;
  readonly model: string | null;
  readonly year: number | null;
  readonly favorite: boolean;
  readonly coverPhoto?: { readonly contentPath: string } | undefined;
  readonly approximateLocation: { readonly city: string; readonly province: string };
  readonly displayPrice: { readonly amountMinor: number; readonly label: string };
  readonly currency: string;
  readonly securityDeposit?:
    | {
        readonly amountMinor: number | null;
        readonly currency: string | null;
        readonly required: boolean;
      }
    | undefined;
  readonly rating?:
    { readonly averageRating: string | null; readonly reviewCount: number } | undefined;
}

export interface RecentVehicleRecord {
  readonly viewedAt: string;
  readonly vehicle: {
    readonly vehicleId: string;
    readonly make: string | null;
    readonly model: string | null;
    readonly year: number | null;
    readonly favorite: boolean;
    readonly location: { readonly city: string; readonly province: string };
    readonly pricing: { readonly currency: string; readonly dailyRateMinor: number };
    readonly photos?: readonly { readonly contentPath: string }[];
    readonly rating?: { readonly averageRating: string | null; readonly reviewCount: number };
  };
}

const allowedCriteria = new Set([
  'source',
  'categoryId',
  'make',
  'seats',
  'transmission',
  'powertrain',
  'minPrice',
  'maxPrice',
  'handover',
  'returnHandover',
]);
const transmissions = new Set(['AUTOMATIC', 'MANUAL', 'CVT', 'DCT', 'OTHER']);
const powertrains = new Set(['ICE', 'HYBRID', 'PLUG_IN_HYBRID', 'BATTERY_ELECTRIC']);
const handovers = new Set(['ANY', 'PICKUP_AVAILABLE', 'DELIVERY_AVAILABLE', 'PICKUP_AND_DELIVERY']);
const returnHandovers = new Set(['ANY', 'RENTER_RETURN_AVAILABLE', 'OWNER_COLLECTION_AVAILABLE']);

function optionalString(value: unknown): string | null {
  return value === undefined || (typeof value === 'string' && value.length > 0)
    ? ((value ?? '') as string)
    : null;
}

function optionalInteger(value: unknown, minimum: number): number | null {
  return value === undefined || (Number.isInteger(value) && (value as number) >= minimum)
    ? ((value ?? 0) as number)
    : null;
}

export function reconstructSearch(record: HistorySearchRecord): ReconstructedSearch | null {
  const criteria = record.criteria;
  if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) return null;
  const saved = criteria as Record<string, unknown>;
  if (saved.source !== 'PLACE' || Object.keys(saved).some((key) => !allowedCriteria.has(key)))
    return null;
  if (
    typeof record.city !== 'string' ||
    typeof record.placeLabel !== 'string' ||
    typeof record.province !== 'string' ||
    !record.city.trim() ||
    !record.placeLabel.trim() ||
    !Number.isFinite(record.centerLatitude) ||
    !Number.isFinite(record.centerLongitude) ||
    record.centerLatitude === null ||
    record.centerLongitude === null ||
    Math.abs(record.centerLatitude) > 90 ||
    Math.abs(record.centerLongitude) > 180 ||
    !Number.isInteger(record.radiusKm) ||
    record.radiusKm < 1 ||
    record.radiusKm > 100
  )
    return null;

  const categoryId = optionalString(saved.categoryId);
  const make = optionalString(saved.make);
  const seats = optionalInteger(saved.seats, 1);
  const transmission = optionalString(saved.transmission);
  const powertrain = optionalString(saved.powertrain);
  const minPrice = optionalInteger(saved.minPrice, 0);
  const maxPrice = optionalInteger(saved.maxPrice, 0);
  const handover = optionalString(saved.handover);
  const returnHandover = optionalString(saved.returnHandover);
  if (
    [
      categoryId,
      make,
      seats,
      transmission,
      powertrain,
      minPrice,
      maxPrice,
      handover,
      returnHandover,
    ].includes(null)
  )
    return null;
  if (
    (transmission && !transmissions.has(transmission)) ||
    (powertrain && !powertrains.has(powertrain)) ||
    (handover && !handovers.has(handover)) ||
    (returnHandover && !returnHandovers.has(returnHandover)) ||
    (minPrice && maxPrice && minPrice > maxPrice)
  )
    return null;
  if (
    (record.rentalStart !== null && typeof record.rentalStart !== 'string') ||
    (record.rentalEnd !== null && typeof record.rentalEnd !== 'string')
  )
    return null;
  if ((record.rentalStart === null) !== (record.rentalEnd === null)) return null;
  const start = record.rentalStart ? new Date(record.rentalStart) : null;
  const end = record.rentalEnd ? new Date(record.rentalEnd) : null;
  if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime())))
    return null;
  if (start && end && end <= start) return null;

  const query = new URLSearchParams({
    latitude: String(record.centerLatitude),
    longitude: String(record.centerLongitude),
    radius: String(record.radiusKm),
    mode: 'LIST',
    sort: 'RECOMMENDED',
    limit: '6',
  });
  if (start && end) {
    query.set('start', start.toISOString());
    query.set('end', end.toISOString());
  }
  if (categoryId) query.set('categoryId', categoryId);
  if (make) query.set('make', make);
  if (seats) query.set('seats', String(seats));
  if (transmission) query.set('transmission', transmission);
  if (powertrain) query.set('powertrain', powertrain);
  if (minPrice) query.set('minPrice', String(minPrice));
  if (maxPrice) query.set('maxPrice', String(maxPrice));
  if (handover && handover !== 'ANY') query.set('handover', handover);
  if (returnHandover && returnHandover !== 'ANY') query.set('returnHandover', returnHandover);

  return {
    title: `Continue exploring ${record.placeLabel.trim()}`,
    query: query.toString(),
    location: {
      label: record.placeLabel.trim(),
      detail: record.province.trim(),
      city: record.city.trim(),
      province: record.province.trim(),
      latitude: record.centerLatitude,
      longitude: record.centerLongitude,
    },
    radiusKm: record.radiusKm,
    start,
    end,
    categoryId: categoryId!,
    make: make!,
    seats: seats ? String(seats) : '',
    transmission: transmission!,
    powertrain: powertrain!,
    minPrice: minPrice ? String(minPrice / 100) : '',
    maxPrice: maxPrice ? String(maxPrice / 100) : '',
    handover: handover || 'ANY',
    returnHandover: returnHandover || 'ANY',
  };
}

export function latestReconstructibleSearch(
  records: readonly HistorySearchRecord[],
): ReconstructedSearch | null {
  for (const record of records) {
    const result = reconstructSearch(record);
    if (result) return result;
  }
  return null;
}

export function recentVehicleCards(records: readonly RecentVehicleRecord[]): ExploreRailCard[] {
  const seen = new Set<string>();
  return records.flatMap(({ vehicle }) => {
    if (seen.has(vehicle.vehicleId)) return [];
    seen.add(vehicle.vehicleId);
    return [
      {
        vehicleId: vehicle.vehicleId,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        favorite: vehicle.favorite,
        coverPhoto: vehicle.photos?.[0],
        approximateLocation: vehicle.location,
        displayPrice: { amountMinor: vehicle.pricing.dailyRateMinor, label: 'From' },
        currency: vehicle.pricing.currency,
        rating: vehicle.rating,
      },
    ];
  });
}
