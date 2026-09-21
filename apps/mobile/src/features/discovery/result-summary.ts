interface ResultSummaryInput {
  readonly hasNextPage: boolean;
  readonly initialError: boolean;
  readonly initialLoading: boolean;
  readonly loadedCount: number;
}

export function uniqueVehicleCount(items: readonly { readonly vehicleId: string }[]) {
  return new Set(items.map(({ vehicleId }) => vehicleId)).size;
}

export function formatResultSummary({
  hasNextPage,
  initialError,
  initialLoading,
  loadedCount,
}: ResultSummaryInput) {
  if (loadedCount > 0) {
    const noun = loadedCount === 1 ? 'car' : 'cars';
    return `${hasNextPage ? 'Over ' : ''}${loadedCount} ${noun} available`;
  }
  if (initialLoading) return 'Updating cars…';
  if (initialError) return 'Vehicle results unavailable';
  return 'No cars available in this area';
}
