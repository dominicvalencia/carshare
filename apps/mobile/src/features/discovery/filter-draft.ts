export type DiscoveryFilters = {
  readonly radiusKm: number;
  readonly make: string;
  readonly categoryId: string;
  readonly seats: string;
  readonly transmission: string;
  readonly powertrain: string;
  readonly minPrice: string;
  readonly maxPrice: string;
  readonly handover: string;
  readonly returnHandover: string;
};

export const DEFAULT_DISCOVERY_FILTERS: DiscoveryFilters = {
  radiusKm: 25,
  make: '',
  categoryId: '',
  seats: '',
  transmission: '',
  powertrain: '',
  minPrice: '',
  maxPrice: '',
  handover: 'ANY',
  returnHandover: 'ANY',
};

export function cloneDiscoveryFilters(filters: DiscoveryFilters): DiscoveryFilters {
  return { ...filters };
}

export function discoveryFiltersEqual(left: DiscoveryFilters, right: DiscoveryFilters) {
  return (
    left.radiusKm === right.radiusKm &&
    left.make === right.make &&
    left.categoryId === right.categoryId &&
    left.seats === right.seats &&
    left.transmission === right.transmission &&
    left.powertrain === right.powertrain &&
    left.minPrice === right.minPrice &&
    left.maxPrice === right.maxPrice &&
    left.handover === right.handover &&
    left.returnHandover === right.returnHandover
  );
}

export function priceRangeError(filters: Pick<DiscoveryFilters, 'minPrice' | 'maxPrice'>) {
  const minimum = filters.minPrice ? Number(filters.minPrice) : null;
  const maximum = filters.maxPrice ? Number(filters.maxPrice) : null;
  if (minimum != null && (!Number.isFinite(minimum) || minimum < 0))
    return 'Enter a valid minimum daily price.';
  if (maximum != null && (!Number.isFinite(maximum) || maximum < 0))
    return 'Enter a valid maximum daily price.';
  if (minimum != null && maximum != null && minimum > maximum)
    return 'Minimum price cannot be greater than maximum price.';
  return '';
}
