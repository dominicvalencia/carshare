export interface RailLocation {
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly source?: 'DEVICE' | undefined;
}

export const EXPLORE_PRIMARY_RAIL_LIMIT = 6;
export const EXPLORE_SECONDARY_RAIL_MINIMUM = 3;

export interface ExploreRailVehicle {
  readonly vehicleId: string;
  readonly category?: { readonly code: string; readonly name: string } | null;
  readonly displayPrice: { readonly amountMinor: number };
}

export interface ContextualExploreRail<T extends ExploreRailVehicle> {
  readonly key: 'PRIMARY' | 'BUDGET' | 'SUV' | 'ELECTRIC' | 'RECENT';
  readonly title: string;
  readonly items: readonly T[];
}

export function areaRailTitle(explicitLocation: boolean, location: RailLocation): string {
  if (!explicitLocation) return 'Explore cars';
  if (location.source === 'DEVICE') return 'Cars near you';
  if (location.label === 'Current area') return 'Explore cars';
  return `Cars in ${location.label}`;
}

export function exploreRailQuery(
  location: RailLocation,
  radiusKm: number,
  kind: 'AREA' | 'ELECTRIC' | 'RECENT',
  filters: {
    readonly categoryId?: string;
    readonly handover?: string;
    readonly make?: string;
    readonly maxPrice?: string;
    readonly minPrice?: string;
    readonly returnHandover?: string;
    readonly powertrain?: string;
    readonly seats?: string;
    readonly transmission?: string;
  } = {},
): string {
  const query = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    radius: String(radiusKm),
    sort: kind === 'RECENT' ? 'NEWEST' : 'RECOMMENDED',
    limit: kind === 'AREA' ? '18' : '6',
    mode: 'LIST',
  });
  if (filters.categoryId) query.set('categoryId', filters.categoryId);
  if (filters.make?.trim()) query.set('make', filters.make.trim());
  if (filters.seats) query.set('seats', filters.seats);
  if (filters.transmission) query.set('transmission', filters.transmission);
  if (filters.minPrice) query.set('minPrice', String(Math.round(Number(filters.minPrice) * 100)));
  if (filters.maxPrice) query.set('maxPrice', String(Math.round(Number(filters.maxPrice) * 100)));
  const powertrain = kind === 'ELECTRIC' ? 'BATTERY_ELECTRIC' : filters.powertrain;
  if (powertrain) query.set('powertrain', powertrain);
  if (filters.handover && filters.handover !== 'ANY') query.set('handover', filters.handover);
  if (filters.returnHandover && filters.returnHandover !== 'ANY')
    query.set('returnHandover', filters.returnHandover);
  return query.toString();
}

function sameVehicleSet<T extends { readonly vehicleId: string }>(
  left: readonly T[],
  right: readonly T[],
): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right.map(({ vehicleId }) => vehicleId));
  return left.every(({ vehicleId }) => rightIds.has(vehicleId));
}

function isSuv(vehicle: ExploreRailVehicle): boolean {
  const category = vehicle.category;
  if (!category) return false;
  return [category.code, category.name].some((value) => value.trim().toUpperCase() === 'SUV');
}

export function contextualExploreRails<T extends ExploreRailVehicle>({
  area,
  electric,
  recent,
  primaryTitle,
}: {
  readonly area: readonly T[];
  readonly electric: readonly T[];
  readonly recent: readonly T[];
  readonly primaryTitle: string;
}): ContextualExploreRail<T>[] {
  const primary = uniqueRailVehicles(area).slice(0, EXPLORE_PRIMARY_RAIL_LIMIT);
  if (primary.length === 0) return [];

  const rails: ContextualExploreRail<T>[] = [
    { key: 'PRIMARY', title: primaryTitle, items: primary },
  ];
  const append = (
    key: ContextualExploreRail<T>['key'],
    title: string,
    candidates: readonly T[],
    limit = EXPLORE_PRIMARY_RAIL_LIMIT,
  ) => {
    const items = uniqueRailVehicles(candidates).slice(0, limit);
    if (items.length < EXPLORE_SECONDARY_RAIL_MINIMUM) return;
    if (rails.some((rail) => sameVehicleSet(rail.items, items))) return;
    rails.push({ key, title, items });
  };

  append(
    'BUDGET',
    'Budget-friendly',
    [...area].sort(
      (left, right) =>
        left.displayPrice.amountMinor - right.displayPrice.amountMinor ||
        left.vehicleId.localeCompare(right.vehicleId),
    ),
    EXPLORE_SECONDARY_RAIL_MINIMUM,
  );
  append('SUV', 'SUVs near you', area.filter(isSuv));
  append('ELECTRIC', 'EVs near you', electric);
  append('RECENT', 'Recently added', recent);
  return rails;
}

export function uniqueRailVehicles<T extends { readonly vehicleId: string }>(
  vehicles: readonly T[],
): T[] {
  const seen = new Set<string>();
  return vehicles.filter((vehicle) => {
    if (seen.has(vehicle.vehicleId)) return false;
    seen.add(vehicle.vehicleId);
    return true;
  });
}

export function showTripRail(datesExplicit: boolean, start: Date, end: Date): boolean {
  return datesExplicit && end.getTime() > start.getTime();
}
