export type AdaptiveSheetLayout = {
  readonly height: number;
  readonly intrinsicHeight: number;
  readonly scrollEnabled: boolean;
};

export function adaptiveSheetLayout({
  contentHeight,
  headerHeight,
  maxSafeViewportHeight,
  safeAreaAllowance,
}: {
  readonly contentHeight: number;
  readonly headerHeight: number;
  readonly maxSafeViewportHeight: number;
  readonly safeAreaAllowance: number;
}): AdaptiveSheetLayout {
  const intrinsicHeight = Math.max(0, headerHeight + contentHeight + safeAreaAllowance);
  const height = Math.min(intrinsicHeight, Math.max(0, maxSafeViewportHeight));

  return {
    height,
    intrinsicHeight,
    scrollEnabled: intrinsicHeight > maxSafeViewportHeight,
  };
}
