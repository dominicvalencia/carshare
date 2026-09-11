import type { MobileMode } from './routes';

export function resolvePersonaMode({
  initialPersona,
  ownerEnabled,
  renterEnabled,
  savedMode,
}: {
  readonly initialPersona: 'RENTER' | 'OWNER' | null;
  readonly ownerEnabled: boolean;
  readonly renterEnabled: boolean;
  readonly savedMode: MobileMode | null;
}): MobileMode | null {
  if (savedMode === 'renter' && renterEnabled) return 'renter';
  if (savedMode === 'owner' && ownerEnabled) return 'owner';
  if (initialPersona === 'RENTER' && renterEnabled) return 'renter';
  if (initialPersona === 'OWNER' && ownerEnabled) return 'owner';
  if (renterEnabled) return 'renter';
  if (ownerEnabled) return 'owner';
  return null;
}

export function shouldPresentOwnerFirstEntry({
  firstEntryIntent,
  initialPersona,
  mode,
  ownerEnabled,
  ownerOnboardingFirstEnteredAt,
}: {
  readonly firstEntryIntent: boolean;
  readonly initialPersona: 'RENTER' | 'OWNER' | null;
  readonly mode: MobileMode;
  readonly ownerEnabled: boolean;
  readonly ownerOnboardingFirstEnteredAt: string | null;
}): boolean {
  return (
    ownerEnabled &&
    mode === 'owner' &&
    !ownerOnboardingFirstEnteredAt &&
    (initialPersona === 'OWNER' || firstEntryIntent)
  );
}
