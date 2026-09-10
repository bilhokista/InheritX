/**
 * Environment coherence checks for the network banner.
 *
 * Pure: takes the configuration as arguments rather than reading
 * `process.env`, so every branch is reachable from a test.
 */

import { isValidContractId } from "@/app/lib/validation/inheritancePlan";

export type NetworkName = "testnet" | "public" | "unknown";

export interface NetworkConfigIssue {
  severity: "error" | "warning";
  message: string;
}

/** Passphrases are the authoritative network identifier, not the RPC host. */
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";

export function networkFromPassphrase(passphrase: string): NetworkName {
  if (passphrase === TESTNET_PASSPHRASE) return "testnet";
  if (passphrase === PUBLIC_PASSPHRASE) return "public";
  return "unknown";
}

/**
 * Best-effort network guess from an RPC hostname.
 *
 * Only used to cross-check the passphrase. `null` means the host says
 * nothing — a private or self-hosted node — which must not be reported as a
 * mismatch.
 */
export function networkFromRpcUrl(rpcUrl: string): NetworkName | null {
  const url = rpcUrl.toLowerCase();
  if (url.includes("testnet") || url.includes("futurenet")) return "testnet";
  if (url.includes("mainnet") || url.includes("pubnet")) return "public";
  return null;
}

/**
 * Problems with the current configuration, worst first.
 *
 * The mismatch check is the one worth having: a passphrase and an RPC host
 * pointing at different networks means transactions are simulated on one
 * chain and signed for another. That fails at submission with an opaque
 * error, long after the point where the cause was visible.
 *
 * What this deliberately cannot do is verify the contract id is *actually
 * deployed* — that needs a live RPC call, and a banner that blocks on the
 * network to render is worse than one that checks what it can. Format and
 * coherence are what is knowable synchronously.
 */
export function describeNetworkConfig(params: {
  contractId: string;
  rpcUrl: string;
  passphrase: string;
}): NetworkConfigIssue[] {
  const issues: NetworkConfigIssue[] = [];
  const contractId = params.contractId.trim();

  if (!contractId) {
    issues.push({
      severity: "error",
      message:
        "NEXT_PUBLIC_INHERITANCE_CONTRACT_ID is not set — on-chain actions will fail.",
    });
  } else if (!isValidContractId(contractId)) {
    issues.push({
      severity: "error",
      message: `Configured contract id is not a valid Soroban contract address (expected a C… strkey).`,
    });
  }

  if (!params.rpcUrl.trim()) {
    issues.push({
      severity: "error",
      message: "NEXT_PUBLIC_SOROBAN_RPC_URL is not set.",
    });
  }

  const declared = networkFromPassphrase(params.passphrase);
  const implied = networkFromRpcUrl(params.rpcUrl);

  if (declared === "unknown") {
    issues.push({
      severity: "warning",
      message: "Network passphrase is not the standard testnet or public value.",
    });
  } else if (implied && implied !== declared) {
    issues.push({
      severity: "error",
      message: `Network mismatch: the passphrase says ${declared} but the RPC URL looks like ${implied}.`,
    });
  }

  return issues;
}

/** Shortened contract id for display, e.g. "CAAAAA…AAAA". */
export function shortenContractId(contractId: string, lead = 6, tail = 4): string {
  const trimmed = contractId.trim();
  if (trimmed.length <= lead + tail + 1) return trimmed;
  return `${trimmed.slice(0, lead)}…${trimmed.slice(-tail)}`;
}
