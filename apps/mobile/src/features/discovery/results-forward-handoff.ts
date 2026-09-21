export function clampUnit(value: number) {
  'worklet';
  return Math.max(0, Math.min(1, value));
}

/** Gesture Handler reports upward translation as negative; presentation uses positive travel. */
export function normalizedUpwardTravel(translationY: number) {
  'worklet';
  return Math.max(0, -translationY);
}

export function normalizedDownwardTravel(translationY: number) {
  'worklet';
  return Math.max(0, translationY);
}

export function eligibleForwardRemainder(upwardTravel: number, handoffTravel: number) {
  'worklet';
  return Math.max(0, upwardTravel - handoffTravel);
}

export function eligibleReverseRemainder(downwardTravel: number, topReachedTravel: number) {
  'worklet';
  if (topReachedTravel < 0) return 0;
  return Math.max(0, downwardTravel - topReachedTravel);
}

export function reverseCollapseProgress(eligibleRestore: number, collapseDistance: number) {
  'worklet';
  if (collapseDistance <= 0) return 1;
  return clampUnit(1 - eligibleRestore / collapseDistance);
}

export function measuredMaxListOffset(contentHeight: number, viewportHeight: number) {
  'worklet';
  if (contentHeight <= 0 || viewportHeight <= 0) return 0;
  return Math.max(0, contentHeight - viewportHeight);
}

export function forwardSyntheticTarget(
  handoffStartOffset: number,
  remainder: number,
  maxOffset: number,
) {
  'worklet';
  return Math.max(0, Math.min(maxOffset, handoffStartOffset + remainder));
}
