import { describe, expect, it } from "vitest";

import {
  MAX_INACTIVITY_DAYS,
  MIN_INACTIVITY_DAYS,
  SECONDS_PER_DAY,
  clampInactivityDays,
  daysToSeconds,
  describeExpiry,
  expiryDate,
  formatExpiryDate,
  parseInactivityDays,
} from "@/lib/gracePeriod";

const FROM = new Date("2026-01-15T12:00:00Z");

describe("parseInactivityDays", () => {
  it("reads a plain number", () => {
    expect(parseInactivityDays("180")).toBe(180);
    expect(parseInactivityDays("  90  ")).toBe(90);
  });

  it("returns null for an empty field so the user can keep typing", () => {
    // Snapping to 1 mid-edit would fight the person clearing the box.
    expect(parseInactivityDays("")).toBeNull();
    expect(parseInactivityDays("   ")).toBeNull();
  });

  it("returns null for something that is not a number", () => {
    // `Number("abc")` is NaN, which used to reach `days * 86400`.
    expect(parseInactivityDays("abc")).toBeNull();
    expect(parseInactivityDays("12abc")).toBeNull();
  });

  it("clamps values outside the supported range", () => {
    // `min`/`max` on a number input restrict the spinner, not typing or
    // pasting, so the clamp cannot be assumed.
    expect(parseInactivityDays("0")).toBe(MIN_INACTIVITY_DAYS);
    expect(parseInactivityDays("-5")).toBe(MIN_INACTIVITY_DAYS);
    expect(parseInactivityDays("99999")).toBe(MAX_INACTIVITY_DAYS);
  });

  it("rounds a fractional day", () => {
    expect(parseInactivityDays("30.4")).toBe(30);
    expect(parseInactivityDays("30.6")).toBe(31);
  });
});

describe("clampInactivityDays", () => {
  it("keeps a value already in range", () => {
    expect(clampInactivityDays(180)).toBe(180);
    expect(clampInactivityDays(MIN_INACTIVITY_DAYS)).toBe(MIN_INACTIVITY_DAYS);
    expect(clampInactivityDays(MAX_INACTIVITY_DAYS)).toBe(MAX_INACTIVITY_DAYS);
  });

  it("falls back to the minimum for a non-finite value", () => {
    expect(clampInactivityDays(Number.NaN)).toBe(MIN_INACTIVITY_DAYS);
    expect(clampInactivityDays(Number.POSITIVE_INFINITY)).toBe(MAX_INACTIVITY_DAYS);
  });
});

describe("daysToSeconds", () => {
  it("converts whole days", () => {
    expect(daysToSeconds(1)).toBe(SECONDS_PER_DAY);
    expect(daysToSeconds(180)).toBe(180 * SECONDS_PER_DAY);
  });

  it("never produces zero or NaN seconds", () => {
    // A grace period of 0 means the plan triggers immediately.
    expect(daysToSeconds(0)).toBe(SECONDS_PER_DAY);
    expect(daysToSeconds(Number.NaN)).toBe(SECONDS_PER_DAY);
  });
});

describe("expiryDate", () => {
  it("adds the requested number of days", () => {
    expect(expiryDate(30, FROM).toISOString().slice(0, 10)).toBe("2026-02-14");
  });

  it("crosses a year boundary correctly", () => {
    expect(expiryDate(365, FROM).toISOString().slice(0, 10)).toBe("2027-01-15");
  });

  it("handles a leap day in the span", () => {
    const fromLeapYear = new Date("2028-02-01T12:00:00Z");
    // 2028 is a leap year, so 29 days from 1 February lands on 1 March.
    expect(expiryDate(29, fromLeapYear).toISOString().slice(0, 10)).toBe("2028-03-01");
  });

  it("does not mutate the date it was given", () => {
    const original = new Date(FROM.getTime());
    expiryDate(90, original);
    expect(original.getTime()).toBe(FROM.getTime());
  });

  it("clamps before computing, so a bad value cannot produce a wild date", () => {
    expect(expiryDate(0, FROM).toISOString().slice(0, 10)).toBe("2026-01-16");
  });
});

describe("formatExpiryDate", () => {
  it("spells the month out rather than using an ambiguous numeric order", () => {
    // "03/12/2027" means two different days depending on the reader.
    const formatted = formatExpiryDate(new Date("2027-03-12T12:00:00Z"), "en-GB");
    expect(formatted).toContain("March");
    expect(formatted).toContain("2027");
    expect(formatted).toContain("12");
  });
});

describe("describeExpiry", () => {
  it("names both the duration and the resulting date", () => {
    const text = describeExpiry(30, FROM, "en-GB");
    expect(text).toContain("30 days");
    expect(text).toContain("February");
    expect(text).toContain("2026");
  });

  it("uses the singular for one day", () => {
    expect(describeExpiry(1, FROM, "en-GB")).toContain("1 day of");
  });

  it("describes the clamped value, not the raw one", () => {
    // Otherwise the sentence claims a duration the plan will not use.
    expect(describeExpiry(0, FROM, "en-GB")).toContain("1 day");
    expect(describeExpiry(99999, FROM, "en-GB")).toContain(`${MAX_INACTIVITY_DAYS} days`);
  });
});
