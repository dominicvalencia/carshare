export interface PasswordResetLink {
  readonly matched: boolean;
  readonly token?: string;
}

export function passwordResetLink(url: string | null, scheme = 'carrental'): PasswordResetLink {
  if (!url) return { matched: false };
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== `${scheme}:` ||
      parsed.hostname !== 'reset-password' ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    )
      return { matched: false };
    const token = parsed.searchParams.get('token')?.trim();
    return token && /^[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/iu.test(token)
      ? { matched: true, token }
      : { matched: true };
  } catch {
    return { matched: false };
  }
}
