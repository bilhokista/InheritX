import { Networks } from "@stellar/stellar-sdk";

/**
 * Soroban RPC endpoint used to simulate/build transactions from the browser.
 * Defaults to the public Testnet RPC node.
 */
export const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";

/**
 * Additional Soroban RPC endpoints to fall back to, comma-separated.
 *
 * Empty by default: which providers this app is willing to send traffic to is
 * an operator's decision, so no third-party node is hardcoded here. When set,
 * the error boundary can offer a one-click switch to the next one.
 */
export const SOROBAN_RPC_URLS = process.env.NEXT_PUBLIC_SOROBAN_RPC_URLS;

/** Network passphrase the built transaction is signed against. */
export const STELLAR_NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;

/**
 * Deployed `inheritance-contract` Soroban contract id (C... strkey). Read
 * lazily (rather than snapshotted into a module-level constant) so it can be
 * configured per-test via `process.env` without requiring a module reset.
 */
export function getInheritanceContractId(): string {
  return process.env.NEXT_PUBLIC_INHERITANCE_CONTRACT_ID ?? "";
}

/** Stellar Expert network segment used to build explorer links. */
const STELLAR_EXPERT_NETWORK =
  STELLAR_NETWORK_PASSPHRASE === Networks.PUBLIC ? "public" : "testnet";

/** Builds a Stellar Expert explorer URL for a submitted transaction hash. */
export function stellarExpertTxUrl(hash: string): string {
  return `https://stellar.expert/explorer/${STELLAR_EXPERT_NETWORK}/tx/${hash}`;
}

/** Number of decimal places assumed for Soroban token amounts (SEP-41 default). */
export const TOKEN_DECIMALS = 7;

/** Seconds a built transaction remains valid for before it must be rebuilt/re-signed. */
export const TRANSACTION_TIMEOUT_SECONDS = 180;
