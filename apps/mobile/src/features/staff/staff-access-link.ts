export interface StaffAccessLink {
  readonly handle?: string;
  readonly matched: boolean;
}

export function staffAccessLink(url: string | null, scheme = 'carrental'): StaffAccessLink {
  if (!url) return { matched: false };
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (
      parsed.protocol !== `${scheme}:` ||
      parsed.hostname !== 'owner' ||
      segments[0] !== 'staff-access' ||
      segments.length !== 2
    )
      return { matched: false };
    const handle = decodeURIComponent(segments[1] ?? '').trim();
    return handle ? { handle, matched: true } : { matched: true };
  } catch {
    return { matched: false };
  }
}
