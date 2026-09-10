/**
 * Inactivity grace period: input handling and the expiry preview.
 *
 * Pure, so the clamping rules and the date arithmetic can be tested without
 * rendering the plan form.
 */

export const MIN_INACTIVITY_DAYS = 1;
/** Ten years. Matches the `max` the form already advertised. */
export const MAX_INACTIVITY_DAYS = 3650;

export const SECONDS_PER_DAY = 86_400;

/** Common choices, offered as one-click shortcuts beside the free input. */
export const INACTIVITY_PRESETS = [30, 90, 180, 365] as const;

/**
 * Turns raw input into a usable day count.
 *
 * `Number("")` is `0` and `Number("abc")` is `NaN`, and the form fed both
 * straight into `grace_period: inactivityDays * 86400` — so clearing the field
 * produced a plan that triggers immediately, and typing a letter produced
 * `NaN` seconds. `min`/`max` on a bare `<input type="number">` restrict the
 * spinner, not what a person can type or paste, so the clamp has to happen
 * here rather than being assumed.
 *
 * Returns `null` for input that is not a number at all, letting the caller
 * keep showing an empty field while the user is mid-edit instead of snapping
 * the value to 1 under their cursor.
 */
export function parseInactivityDays(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;

  return clampInactivityDays(value);
}

/** Constrains a day count to the supported range, rounding to whole days. */
export function clampInactivityDays(value: number): number {
  // Only NaN needs special handling: it has no position on the number line, so
  // the minimum is the safe reading. ±Infinity does have one, and falls out of
  // the clamp below correctly — guarding on `isFinite` instead would send
  // "impossibly large" to the *minimum*, which is the opposite of intent.
  if (Number.isNaN(value)) return MIN_INACTIVITY_DAYS;

  const whole = Math.round(value);
  return Math.min(MAX_INACTIVITY_DAYS, Math.max(MIN_INACTIVITY_DAYS, whole));
}

/** Grace period in seconds, which is what the contract stores. */
export function daysToSeconds(days: number): number {
  return clampInactivityDays(days) * SECONDS_PER_DAY;
}

/**
 * The moment the plan would trigger if the wallet were never pinged again.
 *
 * Built by adding whole days rather than milliseconds so the result lands on
 * the same wall-clock time across a daylight-saving boundary — "180 days from
 * now" should not drift by an hour depending on the month.
 */
export function expiryDate(days: number, from: Date = new Date()): Date {
  const result = new Date(from.getTime());
  result.setDate(result.getDate() + clampInactivityDays(days));
  return result;
}

/**
 * Human-readable expiry preview, e.g. "12 March 2027".
 *
 * Uses the viewer's locale rather than a fixed format: this date is the whole
 * point of the control, and `03/12/2027` means two different days depending on
 * where the reader is.
 */
export function formatExpiryDate(date: Date, locale?: string): string {
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Full sentence shown under the input. */
export function describeExpiry(days: number, from: Date = new Date(), locale?: string): string {
  const clamped = clampInactivityDays(days);
  const noun = clamped === 1 ? "day" : "days";
  return (
    `Inheritance triggers after ${clamped} ${noun} of wallet inactivity — ` +
    `on ${formatExpiryDate(expiryDate(clamped, from), locale)} if you never ping again.`
  );
}
