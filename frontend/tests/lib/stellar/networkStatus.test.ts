import { describe, expect, it } from "vitest";

import {
  describeNetworkConfig,
  networkFromPassphrase,
  networkFromRpcUrl,
  shortenContractId,
} from "@/app/lib/stellar/networkStatus";

const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";
const TESTNET_RPC = "https://soroban-testnet.stellar.org";
const PUBLIC_RPC = "https://soroban-mainnet.stellar.org";
/** A real C… strkey, so the checksum check passes. */
const VALID_CONTRACT = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";

const ok = { contractId: VALID_CONTRACT, rpcUrl: TESTNET_RPC, passphrase: TESTNET };

describe("networkFromPassphrase", () => {
  it("recognises the two standard networks", () => {
    expect(networkFromPassphrase(TESTNET)).toBe("testnet");
    expect(networkFromPassphrase(PUBLIC)).toBe("public");
  });

  it("reports anything else as unknown rather than guessing", () => {
    expect(networkFromPassphrase("Standalone Network ; February 2017")).toBe("unknown");
    expect(networkFromPassphrase("")).toBe("unknown");
  });
});

describe("networkFromRpcUrl", () => {
  it("reads the network from a recognisable host", () => {
    expect(networkFromRpcUrl(TESTNET_RPC)).toBe("testnet");
    expect(networkFromRpcUrl(PUBLIC_RPC)).toBe("public");
    expect(networkFromRpcUrl("https://rpc.example.com/FUTURENET")).toBe("testnet");
  });

  it("returns null for a host that says nothing", () => {
    // A self-hosted node must not be reported as a mismatch.
    expect(networkFromRpcUrl("https://rpc.internal.example")).toBeNull();
    expect(networkFromRpcUrl("http://localhost:8000")).toBeNull();
  });
});

describe("describeNetworkConfig", () => {
  it("reports nothing when the configuration is coherent", () => {
    expect(describeNetworkConfig(ok)).toEqual([]);
  });

  it("errors when the contract id is missing", () => {
    const issues = describeNetworkConfig({ ...ok, contractId: "" });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("NEXT_PUBLIC_INHERITANCE_CONTRACT_ID");
  });

  it("errors on a malformed contract id", () => {
    for (const bad of ["not-a-contract", "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE", "C123"]) {
      const issues = describeNetworkConfig({ ...ok, contractId: bad });
      expect(issues.some((i) => i.severity === "error")).toBe(true);
    }
  });

  it("errors when the passphrase and RPC host disagree", () => {
    // Simulating on one chain and signing for another fails at submission
    // with an opaque error, long after the cause was visible.
    const issues = describeNetworkConfig({ ...ok, rpcUrl: PUBLIC_RPC });
    const mismatch = issues.find((i) => i.message.includes("Network mismatch"));

    expect(mismatch?.severity).toBe("error");
    expect(mismatch?.message).toContain("testnet");
    expect(mismatch?.message).toContain("public");
  });

  it("does not cry mismatch for an unrecognisable RPC host", () => {
    expect(describeNetworkConfig({ ...ok, rpcUrl: "https://rpc.internal.example" })).toEqual([]);
  });

  it("warns rather than errors on a non-standard passphrase", () => {
    const issues = describeNetworkConfig({
      ...ok,
      passphrase: "Standalone Network ; February 2017",
      rpcUrl: "https://rpc.internal.example",
    });

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("reports every problem at once", () => {
    const issues = describeNetworkConfig({ contractId: "", rpcUrl: "", passphrase: "" });
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe("shortenContractId", () => {
  it("elides the middle of a full id", () => {
    const short = shortenContractId(VALID_CONTRACT);
    expect(short.startsWith("CA3D5K")).toBe(true);
    expect(short.endsWith("GAXE")).toBe(true);
    expect(short.length).toBeLessThan(VALID_CONTRACT.length);
  });

  it("leaves a short value alone rather than mangling it", () => {
    expect(shortenContractId("CABC")).toBe("CABC");
    expect(shortenContractId("")).toBe("");
  });
});
