export type PowertrainClass = 'COMBUSTION' | 'ELECTRIC' | 'ELECTRIFIED' | 'UNKNOWN';

export interface SimilarityVehicle {
  readonly id: string;
  readonly categoryId: string | null;
  readonly dailyRateMinor: number;
  readonly distanceKm: number;
  readonly make: string | null;
  readonly powertrain: string | null;
  readonly ratingReviewCount: number;
  readonly seats: number | null;
  readonly transmission: string | null;
}

export type SimilarityReason =
  | 'SAME_CATEGORY_POWERTRAIN'
  | 'SAME_CATEGORY_SEATS'
  | 'SAME_POWERTRAIN_SEATS'
  | 'SAME_CATEGORY_PRICE';

export interface QualifiedSimilarity<T extends SimilarityVehicle = SimilarityVehicle> {
  readonly vehicle: T;
  readonly reason: SimilarityReason;
  readonly tier: 1 | 2 | 3 | 4;
}

export function powertrainClass(powertrain: string | null): PowertrainClass {
  if (powertrain === 'BATTERY_ELECTRIC') return 'ELECTRIC';
  if (powertrain === 'HYBRID' || powertrain === 'PLUG_IN_HYBRID') return 'ELECTRIFIED';
  if (powertrain === 'ICE') return 'COMBUSTION';
  return 'UNKNOWN';
}

function seatBand(seats: number | null): string {
  if (seats === null) return 'UNKNOWN';
  if (seats <= 2) return 'TWO';
  if (seats <= 5) return 'STANDARD';
  return 'LARGE';
}

export function selectDiverseSavedAnchors<T extends SimilarityVehicle>(
  newestFirst: readonly T[],
  limit = 3,
): T[] {
  const clusters = new Set<string>();
  const result: T[] = [];
  for (const vehicle of newestFirst) {
    const cluster = `${vehicle.categoryId ?? 'UNKNOWN'}:${powertrainClass(vehicle.powertrain)}:${seatBand(vehicle.seats)}`;
    if (clusters.has(cluster)) continue;
    clusters.add(cluster);
    result.push(vehicle);
    if (result.length === limit) break;
  }
  return result;
}

function proportionalPriceDifference(anchor: SimilarityVehicle, candidate: SimilarityVehicle) {
  return anchor.dailyRateMinor > 0
    ? Math.abs(candidate.dailyRateMinor - anchor.dailyRateMinor) / anchor.dailyRateMinor
    : Number.POSITIVE_INFINITY;
}

export function qualifySimilarity<T extends SimilarityVehicle>(
  anchor: SimilarityVehicle,
  candidate: T,
): QualifiedSimilarity<T> | null {
  const sameCategory = Boolean(anchor.categoryId && anchor.categoryId === candidate.categoryId);
  const anchorPowertrain = powertrainClass(anchor.powertrain);
  const samePowertrain =
    anchorPowertrain !== 'UNKNOWN' && anchorPowertrain === powertrainClass(candidate.powertrain);
  const seatDifference =
    anchor.seats === null || candidate.seats === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(anchor.seats - candidate.seats);
  const similarSeats = seatDifference <= 1;
  const similarPrice = proportionalPriceDifference(anchor, candidate) <= 0.25;
  const meaningfulMatches = [sameCategory, samePowertrain, similarSeats, similarPrice].filter(
    Boolean,
  ).length;
  if (meaningfulMatches < 2) return null;
  if (sameCategory && samePowertrain)
    return { reason: 'SAME_CATEGORY_POWERTRAIN', tier: 1, vehicle: candidate };
  if (sameCategory && similarSeats)
    return { reason: 'SAME_CATEGORY_SEATS', tier: 2, vehicle: candidate };
  if (samePowertrain && similarSeats)
    return { reason: 'SAME_POWERTRAIN_SEATS', tier: 3, vehicle: candidate };
  if (sameCategory && similarPrice)
    return { reason: 'SAME_CATEGORY_PRICE', tier: 4, vehicle: candidate };
  return null;
}

export function qualifiedForAnchor<T extends SimilarityVehicle>(
  anchor: SimilarityVehicle,
  candidates: readonly T[],
): QualifiedSimilarity<T>[] {
  return candidates
    .flatMap((candidate) => {
      const qualified = qualifySimilarity(anchor, candidate);
      return qualified ? [qualified] : [];
    })
    .sort((left, right) => {
      const leftVehicle = left.vehicle;
      const rightVehicle = right.vehicle;
      const seatDifference = (vehicle: SimilarityVehicle) =>
        anchor.seats === null || vehicle.seats === null
          ? Number.POSITIVE_INFINITY
          : Math.abs(anchor.seats - vehicle.seats);
      return (
        left.tier - right.tier ||
        seatDifference(leftVehicle) - seatDifference(rightVehicle) ||
        proportionalPriceDifference(anchor, leftVehicle) -
          proportionalPriceDifference(anchor, rightVehicle) ||
        Number(anchor.transmission !== leftVehicle.transmission) -
          Number(anchor.transmission !== rightVehicle.transmission) ||
        Number(anchor.make !== leftVehicle.make) - Number(anchor.make !== rightVehicle.make) ||
        leftVehicle.distanceKm - rightVehicle.distanceKm ||
        rightVehicle.ratingReviewCount - leftVehicle.ratingReviewCount ||
        leftVehicle.id.localeCompare(rightVehicle.id)
      );
    });
}

export function interleaveSimilarity<T extends SimilarityVehicle>(
  queues: readonly (readonly QualifiedSimilarity<T>[])[],
  excludedIds: ReadonlySet<string>,
  limit = 6,
): QualifiedSimilarity<T>[] {
  const seen = new Set(excludedIds);
  const result: QualifiedSimilarity<T>[] = [];
  const offsets = queues.map(() => 0);
  while (result.length < limit) {
    let added = false;
    for (let index = 0; index < queues.length && result.length < limit; index += 1) {
      const queue = queues[index]!;
      let offset = offsets[index] ?? 0;
      while (offset < queue.length) {
        const candidate = queue[offset]!;
        offset += 1;
        offsets[index] = offset;
        if (seen.has(candidate.vehicle.id)) continue;
        seen.add(candidate.vehicle.id);
        result.push(candidate);
        added = true;
        break;
      }
    }
    if (!added) break;
  }
  return result;
}
