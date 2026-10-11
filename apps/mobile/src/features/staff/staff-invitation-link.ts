export interface StaffInvitationLink {
  readonly matched: boolean;
  readonly token?: string;
}

export function staffInvitationLink(url: string | null, scheme = 'carrental'): StaffInvitationLink {
  if (!url) return { matched: false };
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== `${scheme}:` ||
      parsed.hostname !== 'owner' ||
      parsed.pathname !== '/staff-invitation'
    )
      return { matched: false };
    const token = parsed.searchParams.get('token')?.trim();
    return token ? { matched: true, token } : { matched: true };
  } catch {
    return { matched: false };
  }
}
