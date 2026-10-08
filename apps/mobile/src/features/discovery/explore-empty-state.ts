import type { DiscoveryLocationSource } from './discovery-location-storage';

export function exploreEmptyStateCopy({
  datesSelected,
  locationSource,
}: {
  readonly datesSelected: boolean;
  readonly locationSource: DiscoveryLocationSource;
}) {
  const title =
    locationSource === 'DEVICE_LOCATION'
      ? 'No cars nearby'
      : locationSource === 'USER_SELECTED'
        ? 'No cars found in this area'
        : 'No cars found';
  const message = !datesSelected
    ? 'Try another area or add trip dates to find available cars.'
    : locationSource === 'DEVICE_LOCATION'
      ? 'Try another area, adjust your dates, or broaden your filters.'
      : 'Try another location, adjust your dates, or broaden your filters.';
  return { message, title };
}
