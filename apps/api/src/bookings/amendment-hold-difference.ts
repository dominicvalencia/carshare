export interface HoldInterval {
  end: Date;
  start: Date;
}

/** Smallest net-new occupancy intervals; current booking protection is never released. */
export function amendmentHoldDifference(input: {
  currentEnd: Date;
  currentStart: Date;
  proposedEnd: Date;
  proposedStart: Date;
  turnaroundMinutes: number;
}): HoldInterval[] {
  const turnaroundMs = input.turnaroundMinutes * 60_000;
  const currentProtectedEnd = new Date(input.currentEnd.getTime() + turnaroundMs);
  const proposedProtectedEnd = new Date(input.proposedEnd.getTime() + turnaroundMs);
  const candidates: HoldInterval[] = [];
  if (input.proposedStart < input.currentStart)
    candidates.push({ end: input.currentStart, start: input.proposedStart });
  if (proposedProtectedEnd > currentProtectedEnd)
    candidates.push({ end: proposedProtectedEnd, start: currentProtectedEnd });
  return candidates
    .filter(({ start, end }) => start < end)
    .sort((left, right) => left.start.getTime() - right.start.getTime())
    .filter(
      (interval, index, all) =>
        index === 0 ||
        interval.start.getTime() !== all[index - 1]!.start.getTime() ||
        interval.end.getTime() !== all[index - 1]!.end.getTime(),
    );
}
