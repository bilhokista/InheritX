/**
 * Wallet session expiry.
 *
 * Pure, so the timing rules can be tested without a provider, a DOM or a
 * wallet extension.
 */

/** Idle time before a connected wallet session is dropped. */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** How long the warning is shown before the disconnect actually happens. */
export const WARNING_BEFORE_MS = 60 * 1000;

/** Key holding the epoch-ms timestamp of the last recorded activity. */
export const LAST_ACTIVITY_KEY = "inheritx_wallet_last_activity";

export type SessionPhase = "active" | "warning" | "expired";

/**
 * Where a session sits relative to its timeout.
 *
 * `warning` covers the final {@link WARNING_BEFORE_MS} before expiry, which is
 * when the countdown modal should be up.
 */
export function sessionPhase(lastActivityAt: number, now: number): SessionPhase {
  const idleFor = now - lastActivityAt;

  if (idleFor >= SESSION_TIMEOUT_MS) return "expired";
  if (idleFor >= SESSION_TIMEOUT_MS - WARNING_BEFORE_MS) return "warning";
  return "active";
}

/** Milliseconds until the session is dropped. Never negative. */
export function msUntilExpiry(lastActivityAt: number, now: number): number {
  return Math.max(0, lastActivityAt + SESSION_TIMEOUT_MS - now);
}

/** Whole seconds remaining, for the countdown in the warning modal. */
export function secondsUntilExpiry(lastActivityAt: number, now: number): number {
  return Math.ceil(msUntilExpiry(lastActivityAt, now) / 1000);
}

/**
 * Whether a session restored from storage should be rejected.
 *
 * This is the part that actually protects a public terminal. An in-memory
 * 30-minute timer does nothing once the tab is closed: the address is still in
 * `localStorage`, so reopening the page tomorrow silently reconnects the
 * previous person's wallet. Checking the stored timestamp on restore is what
 * closes that hole.
 *
 * A missing or unparseable timestamp counts as expired. That is deliberate: a
 * session written before this check existed has no recorded activity, and
 * treating "unknown" as "still valid" would leave exactly the sessions this
 * change is meant to clear.
 */
export function isStoredSessionExpired(rawTimestamp: string | null, now: number): boolean {
  if (!rawTimestamp) return true;

  const lastActivityAt = Number(rawTimestamp);
  if (!Number.isFinite(lastActivityAt) || lastActivityAt <= 0) return true;

  // A timestamp in the future means a clock change or a tampered value; the
  // safe reading is to start the clock again rather than trust it.
  if (lastActivityAt > now) return false;

  return now - lastActivityAt >= SESSION_TIMEOUT_MS;
}

/** Events that count as the user still being present. */
export const ACTIVITY_EVENTS = [
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "visibilitychange",
] as const;
