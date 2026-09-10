import { describe, expect, it } from "vitest";

import {
  MAX_AUTO_RETRIES,
  computeRetryDelay,
  isTransientRpcError,
  nextEndpoint,
  parseRpcEndpoints,
  shouldAutoRetry,
} from "@/app/lib/stellar/rpcHealth";

const NODE_A = "https://soroban-testnet.stellar.org";
const NODE_B = "https://rpc-b.example.test";
const NODE_C = "https://rpc-c.example.test";

describe("isTransientRpcError", () => {
  it("treats a 504 from the node as transient", () => {
    expect(isTransientRpcError({ status: 504 })).toBe(true);
    expect(isTransientRpcError(new Error("Gateway Timeout (504)"))).toBe(true);
  });

  it.each([408, 425, 429, 500, 502, 503, 504])("retries HTTP %i", (status) => {
    expect(isTransientRpcError({ status })).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])("does not retry HTTP %i", (status) => {
    expect(isTransientRpcError({ status })).toBe(false);
  });

  it("reads a status from any of the shapes clients use", () => {
    expect(isTransientRpcError({ statusCode: 503 })).toBe(true);
    expect(isTransientRpcError({ response: { status: 502 } })).toBe(true);
  });

  it("treats a request that never completed as transient", () => {
    for (const message of [
      "Failed to fetch",
      "NetworkError when attempting to fetch resource",
      "socket hang up",
      "ECONNRESET",
    ]) {
      expect(isTransientRpcError(new Error(message))).toBe(true);
    }
  });

  it("never retries a contract revert", () => {
    for (const message of [
      "HostFunction failed: contract error 3",
      "Transaction simulation failed",
      "txInsufficientBalance",
      "unreachable",
    ]) {
      expect(isTransientRpcError(new Error(message))).toBe(false);
    }
  });

  it("prefers a terminal reading when a revert mentions a timeout", () => {
    // Retrying a rejected transaction burns time and fees on an answer that
    // will not change, so the terminal signal has to win.
    expect(
      isTransientRpcError(new Error("simulation failed: timeout in host function")),
    ).toBe(false);
  });

  it("does not treat an unrecognised error as retryable", () => {
    expect(isTransientRpcError(new Error("something odd"))).toBe(false);
    expect(isTransientRpcError(null)).toBe(false);
    expect(isTransientRpcError(undefined)).toBe(false);
  });
});

describe("computeRetryDelay", () => {
  it("backs off exponentially", () => {
    const noJitter = () => 0.5;
    expect(computeRetryDelay(0, noJitter)).toBe(500);
    expect(computeRetryDelay(1, noJitter)).toBe(1000);
    expect(computeRetryDelay(2, noJitter)).toBe(2000);
  });

  it("caps the delay so a retry is never minutes away", () => {
    expect(computeRetryDelay(20, () => 0.5)).toBe(8000);
  });

  it("stays within the jitter band and never goes negative", () => {
    for (const r of [0, 0.5, 1]) {
      const delay = computeRetryDelay(0, () => r);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(625);
    }
  });

  it("spreads retries across callers", () => {
    // Without jitter every open tab would hit a recovering node at once.
    expect(computeRetryDelay(1, () => 0)).not.toBe(computeRetryDelay(1, () => 1));
  });
});

describe("shouldAutoRetry", () => {
  it("retries a transient failure within budget", () => {
    expect(shouldAutoRetry({ status: 504 }, 0)).toBe(true);
    expect(shouldAutoRetry({ status: 504 }, MAX_AUTO_RETRIES - 1)).toBe(true);
  });

  it("stops once the budget is spent", () => {
    expect(shouldAutoRetry({ status: 504 }, MAX_AUTO_RETRIES)).toBe(false);
  });

  it("never retries a terminal error, even on the first attempt", () => {
    expect(shouldAutoRetry(new Error("contract error 3"), 0)).toBe(false);
  });
});

describe("parseRpcEndpoints", () => {
  it("falls back to the single configured node", () => {
    expect(parseRpcEndpoints(undefined, NODE_A)).toEqual([NODE_A]);
    expect(parseRpcEndpoints("", NODE_A)).toEqual([NODE_A]);
    expect(parseRpcEndpoints("   ", NODE_A)).toEqual([NODE_A]);
  });

  it("splits and trims a configured list", () => {
    expect(parseRpcEndpoints(` ${NODE_A}, ${NODE_B} ,${NODE_C}`, NODE_A)).toEqual([
      NODE_A,
      NODE_B,
      NODE_C,
    ]);
  });

  it("drops duplicates while preserving order", () => {
    // A repeated endpoint would make "switch node" appear to do nothing.
    expect(parseRpcEndpoints(`${NODE_A},${NODE_B},${NODE_A}`, NODE_A)).toEqual([
      NODE_A,
      NODE_B,
    ]);
  });

  it("ignores empty entries from a trailing comma", () => {
    expect(parseRpcEndpoints(`${NODE_A},,${NODE_B},`, NODE_A)).toEqual([NODE_A, NODE_B]);
  });
});

describe("nextEndpoint", () => {
  const all = [NODE_A, NODE_B, NODE_C];

  it("advances to the next node", () => {
    expect(nextEndpoint(all, NODE_A)).toBe(NODE_B);
    expect(nextEndpoint(all, NODE_B)).toBe(NODE_C);
  });

  it("wraps around at the end", () => {
    expect(nextEndpoint(all, NODE_C)).toBe(NODE_A);
  });

  it("returns the same node when it is the only one", () => {
    expect(nextEndpoint([NODE_A], NODE_A)).toBe(NODE_A);
  });

  it("recovers from an endpoint that is not in the list", () => {
    expect(nextEndpoint(all, "https://gone.example.test")).toBe(NODE_A);
  });

  it("does not throw on an empty list", () => {
    expect(nextEndpoint([], NODE_A)).toBe(NODE_A);
  });
});
