import { describe, expect, it } from "vitest";

import {
  SESSION_TIMEOUT_MS,
  WARNING_BEFORE_MS,
  isStoredSessionExpired,
  msUntilExpiry,
  secondsUntilExpiry,
  sessionPhase,
} from "@/lib/walletSession";

const NOW = 1_800_000_000_000;
/** Last activity `idleMs` ago. */
const idle = (idleMs: number) => NOW - idleMs;

describe("sessionPhase", () => {
  it("is active well inside the window", () => {
    expect(sessionPhase(idle(0), NOW)).toBe("active");
    expect(sessionPhase(idle(5 * 60_000), NOW)).toBe("active");
  });

  it("warns for the final minute", () => {
    expect(sessionPhase(idle(SESSION_TIMEOUT_MS - WARNING_BEFORE_MS), NOW)).toBe("warning");
    expect(sessionPhase(idle(SESSION_TIMEOUT_MS - 1), NOW)).toBe("warning");
  });

  it("is still active one millisecond before the warning", () => {
    expect(sessionPhase(idle(SESSION_TIMEOUT_MS - WARNING_BEFORE_MS - 1), NOW)).toBe("active");
  });

  it("expires exactly on the timeout, not after it", () => {
    expect(sessionPhase(idle(SESSION_TIMEOUT_MS), NOW)).toBe("expired");
    expect(sessionPhase(idle(SESSION_TIMEOUT_MS + 60_000), NOW)).toBe("expired");
  });
});

describe("msUntilExpiry", () => {
  it("counts down", () => {
    expect(msUntilExpiry(idle(0), NOW)).toBe(SESSION_TIMEOUT_MS);
    expect(msUntilExpiry(idle(10 * 60_000), NOW)).toBe(SESSION_TIMEOUT_MS - 10 * 60_000);
  });

  it("never goes negative", () => {
    // A negative value would render as a countdown running backwards.
    expect(msUntilExpiry(idle(SESSION_TIMEOUT_MS * 3), NOW)).toBe(0);
  });
});

describe("secondsUntilExpiry", () => {
  it("rounds up so the countdown never shows 0 while time remains", () => {
    expect(secondsUntilExpiry(idle(SESSION_TIMEOUT_MS - 1), NOW)).toBe(1);
    expect(secondsUntilExpiry(idle(SESSION_TIMEOUT_MS - 1500), NOW)).toBe(2);
  });

  it("reaches zero once expired", () => {
    expect(secondsUntilExpiry(idle(SESSION_TIMEOUT_MS), NOW)).toBe(0);
  });

  it("shows the full warning window at its start", () => {
    expect(secondsUntilExpiry(idle(SESSION_TIMEOUT_MS - WARNING_BEFORE_MS), NOW)).toBe(60);
  });
});

describe("isStoredSessionExpired", () => {
  it("accepts a recent session", () => {
    expect(isStoredSessionExpired(String(idle(60_000)), NOW)).toBe(false);
  });

  it("rejects a session older than the timeout", () => {
    // The public-terminal case: close the tab, come back tomorrow.
    expect(isStoredSessionExpired(String(idle(SESSION_TIMEOUT_MS)), NOW)).toBe(true);
    expect(isStoredSessionExpired(String(idle(24 * 60 * 60_000)), NOW)).toBe(true);
  });

  it("rejects a missing timestamp", () => {
    // A session written before this check existed has no recorded activity;
    // treating unknown as valid would leave exactly the sessions this is
    // meant to clear.
    expect(isStoredSessionExpired(null, NOW)).toBe(true);
    expect(isStoredSessionExpired("", NOW)).toBe(true);
  });

  it("rejects an unparseable or nonsensical timestamp", () => {
    expect(isStoredSessionExpired("abc", NOW)).toBe(true);
    expect(isStoredSessionExpired("0", NOW)).toBe(true);
    expect(isStoredSessionExpired("-1", NOW)).toBe(true);
  });

  it("tolerates a timestamp in the future rather than locking the user out", () => {
    // A clock change should restart the window, not deny access.
    expect(isStoredSessionExpired(String(NOW + 60_000), NOW)).toBe(false);
  });
});
