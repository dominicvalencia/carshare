export const APP_LOCK_TIMEOUT_MINUTES = 5;
export const APP_LOCK_TIMEOUT_MS = APP_LOCK_TIMEOUT_MINUTES * 60_000;

export function isValidPin(pin: string) {
  return /^\d{6}$/.test(pin);
}

export function shouldLockAfterInactivity(
  lastInactiveAt: number | null,
  now: number,
  timeoutMs = APP_LOCK_TIMEOUT_MS,
) {
  return lastInactiveAt !== null && now - lastInactiveAt >= timeoutMs;
}

export function accountStorageKey(userId: string) {
  return `carrental.app-lock.${userId}`;
}

export function constantTimeEqual(left: string, right: string) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1)
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}
