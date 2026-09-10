/**
 * Classification and backoff for Soroban RPC failures.
 *
 * Pure and dependency-free so the retry policy can be tested without a network
 * or a rendered boundary.
 */

/** Statuses worth retrying: the node is unhealthy or busy, not the request wrong. */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const TRANSIENT_MESSAGE_PATTERNS = [
  "504",
  "502",
  "503",
  "gateway timeout",
  "bad gateway",
  "service unavailable",
  "too many requests",
  "rate limit",
  "failed to fetch",
  "network request failed",
  "networkerror",
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
  "timeout",
];

/**
 * A contract-level failure. Retrying cannot change the outcome, because the
 * node answered correctly and the answer was "no".
 */
const TERMINAL_MESSAGE_PATTERNS = [
  "unreachable",
  "invalid action",
  "contract error",
  "hostfunction",
  "trapped",
  "insufficient balance",
  "unauthorized",
  "not found",
  "txbadauth",
  "txinsufficientbalance",
  "simulation failed",
];

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const candidate of [e.status, e.statusCode, e.response?.status]) {
    if (typeof candidate === "number") return candidate;
  }
  return undefined;
}

/**
 * Whether `error` is worth retrying against the RPC.
 *
 * Terminal contract failures are checked first: a revert message can mention a
 * timeout in its own text, and retrying a rejected transaction just burns time
 * and fees on an answer that will not change.
 */
export function isTransientRpcError(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== undefined) return TRANSIENT_STATUS.has(status);

  const text = (
    error instanceof Error ? error.message : String(error ?? "")
  ).toLowerCase();

  if (TERMINAL_MESSAGE_PATTERNS.some((p) => text.includes(p))) return false;
  return TRANSIENT_MESSAGE_PATTERNS.some((p) => text.includes(p));
}

export const MAX_AUTO_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;
const JITTER_RATIO = 0.25;

/**
 * Delay before retry `attempt` (0-based): 500ms, 1s, 2s… capped at 8s, with
 * ±25% jitter so a node recovering from an outage is not hit by every open tab
 * at the same instant.
 */
export function computeRetryDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jitter = exponential * JITTER_RATIO * (random() * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

/** Whether another automatic retry is allowed for this error. */
export function shouldAutoRetry(error: unknown, attemptsSoFar: number): boolean {
  return attemptsSoFar < MAX_AUTO_RETRIES && isTransientRpcError(error);
}

// ── Endpoint rotation ──────────────────────────────────────────────────────

/**
 * Configured RPC endpoints, in preference order.
 *
 * Read from `NEXT_PUBLIC_SOROBAN_RPC_URLS` (comma-separated) and falling back
 * to the single `SOROBAN_RPC_URL`. Deliberately not seeded with third-party
 * public nodes: which providers this app is willing to send traffic to is an
 * operator's decision, not a default to inherit from a component.
 */
export function parseRpcEndpoints(
  list: string | undefined,
  fallback: string,
): string[] {
  const parsed = (list ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  const endpoints = parsed.length > 0 ? parsed : [fallback];

  // Preserve order while dropping duplicates: a repeated endpoint would make
  // "switch node" appear to do nothing.
  return Array.from(new Set(endpoints));
}

/** The endpoint after `current`, wrapping around. Returns `current` if it is alone. */
export function nextEndpoint(endpoints: readonly string[], current: string): string {
  if (endpoints.length === 0) return current;
  const index = endpoints.indexOf(current);
  if (index === -1) return endpoints[0];
  return endpoints[(index + 1) % endpoints.length];
}
