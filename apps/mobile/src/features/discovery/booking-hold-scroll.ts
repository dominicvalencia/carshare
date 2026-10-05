export function bookingHoldRevealOffset({
  currentOffset,
  edgePadding,
  obscuredTop,
  sectionHeight,
  sectionTop,
  viewportHeight,
}: {
  readonly currentOffset: number;
  readonly edgePadding: number;
  readonly obscuredTop: number;
  readonly sectionHeight: number;
  readonly sectionTop: number;
  readonly viewportHeight: number;
}): number | null {
  const sectionBottom = sectionTop + sectionHeight;
  const visibleTop = currentOffset + obscuredTop;
  const visibleBottom = currentOffset + viewportHeight - edgePadding;
  if (sectionTop >= visibleTop && sectionBottom <= visibleBottom) return null;
  if (sectionTop < visibleTop) return Math.max(0, sectionTop - obscuredTop - edgePadding);
  return Math.max(0, sectionBottom - viewportHeight + edgePadding);
}
