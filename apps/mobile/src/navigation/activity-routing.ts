export function combinedActivityUnread(
  conversations: readonly { readonly unreadCount: number }[] | undefined,
  unreadNotifications: number | undefined,
): number {
  const messages = conversations?.reduce((sum, item) => sum + item.unreadCount, 0) ?? 0;
  return messages + (unreadNotifications ?? 0);
}

const ownerRentalStatuses = new Set([
  'CONFIRMED',
  'READY_FOR_PICKUP',
  'ACTIVE',
  'RETURN_PENDING',
  'RETURNED',
  'COMPLETED',
]);

export function ownerBookingSurface(status: string): 'request' | 'rental' {
  return ownerRentalStatuses.has(status) ? 'rental' : 'request';
}
