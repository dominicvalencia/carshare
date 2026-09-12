const PUBLIC_CELL_DEGREES = 0.02;

export interface PublicMapPosition {
  readonly mapLatitude: number;
  readonly mapLongitude: number;
  readonly precision: 'APPROXIMATE_CELL';
}

function cellCenter(value: number): number {
  return Number(
    (
      Math.floor(value / PUBLIC_CELL_DEGREES) * PUBLIC_CELL_DEGREES +
      PUBLIC_CELL_DEGREES / 2
    ).toFixed(6),
  );
}

/**
 * Projects a private coordinate to the stable center of an approximately 2 km
 * public cell. The result is presentation-only and must never be used for
 * serviceability, quotes, bookings, or fulfillment.
 */
export function publicMapPosition(latitude: number, longitude: number): PublicMapPosition {
  let mapLatitude = cellCenter(latitude);
  const mapLongitude = cellCenter(longitude);
  if (mapLatitude === latitude && mapLongitude === longitude) {
    mapLatitude = Number((mapLatitude + PUBLIC_CELL_DEGREES / 4).toFixed(6));
  }
  return {
    mapLatitude,
    mapLongitude,
    precision: 'APPROXIMATE_CELL',
  };
}

export function publicMapDistanceKm(distanceKm: number): number {
  return Math.round(distanceKm);
}
