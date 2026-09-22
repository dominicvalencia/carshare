export interface CommittedSearchLocation {
  readonly city: string;
  readonly province: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly source?: 'DEVICE' | undefined;
}

export interface CommittedSearchInput {
  readonly location: CommittedSearchLocation;
  readonly radiusKm: number;
  readonly datesExplicit: boolean;
  readonly start: Date;
  readonly end: Date;
  readonly categoryId: string;
  readonly make: string;
  readonly seats: string;
  readonly transmission: string;
  readonly powertrain: string;
  readonly minPrice: string;
  readonly maxPrice: string;
  readonly handover: string;
}

export function committedSearchPayload(input: CommittedSearchInput) {
  const { location } = input;
  return {
    source: location.source === 'DEVICE' ? 'DEVICE' : 'PLACE',
    city: location.source === 'DEVICE' ? '' : location.city.trim(),
    province: location.source === 'DEVICE' ? '' : location.province.trim(),
    latitude: location.source === 'DEVICE' ? 0 : location.latitude,
    longitude: location.source === 'DEVICE' ? 0 : location.longitude,
    radiusKm: input.radiusKm,
    datesExplicit: input.datesExplicit,
    ...(input.datesExplicit
      ? { start: input.start.toISOString(), end: input.end.toISOString() }
      : {}),
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.make.trim() ? { make: input.make.trim() } : {}),
    ...(input.seats ? { seats: Number(input.seats) } : {}),
    ...(input.transmission ? { transmission: input.transmission } : {}),
    ...(input.powertrain ? { powertrain: input.powertrain } : {}),
    ...(input.minPrice ? { minPrice: Math.round(Number(input.minPrice) * 100) } : {}),
    ...(input.maxPrice ? { maxPrice: Math.round(Number(input.maxPrice) * 100) } : {}),
    ...(input.handover !== 'ANY' ? { handover: input.handover } : {}),
  };
}
