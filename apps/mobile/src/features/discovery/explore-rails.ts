export interface RailLocation {
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly source?: 'DEVICE' | undefined;
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
  kind: 'AREA' | 'ELECTRIC',
  filters: {
    readonly categoryId?: string;
    readonly handover?: string;
    readonly returnHandover?: string;
    readonly powertrain?: string;
    readonly seats?: string;
  } = {},
): string {
  const query = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    radius: String(radiusKm),
    sort: 'RECOMMENDED',
    limit: '6',
    mode: 'LIST',
  });
  if (filters.categoryId && kind === 'AREA') query.set('categoryId', filters.categoryId);
  if (filters.seats && kind === 'AREA') query.set('seats', filters.seats);
  const powertrain = kind === 'ELECTRIC' ? 'BATTERY_ELECTRIC' : filters.powertrain;
  if (powertrain) query.set('powertrain', powertrain);
  if (filters.handover && filters.handover !== 'ANY' && kind === 'AREA')
    query.set('handover', filters.handover);
  if (filters.returnHandover && filters.returnHandover !== 'ANY' && kind === 'AREA')
    query.set('returnHandover', filters.returnHandover);
  return query.toString();
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
