"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, ExternalLink } from "lucide-react";

import {
  SOROBAN_RPC_URL,
  STELLAR_NETWORK_PASSPHRASE,
  getInheritanceContractId,
  stellarExpertContractUrl,
} from "@/app/lib/stellar/network";
import {
  describeNetworkConfig,
  networkFromPassphrase,
  shortenContractId,
} from "@/app/lib/stellar/networkStatus";

/**
 * Shows which contract and network the app is actually talking to.
 *
 * Reads configuration at render rather than module load so a test can set
 * `process.env` without a module reset, matching `getInheritanceContractId`.
 */
export function NetworkBanner({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  const contractId = getInheritanceContractId();
  const issues = describeNetworkConfig({
    contractId,
    rpcUrl: SOROBAN_RPC_URL,
    passphrase: STELLAR_NETWORK_PASSPHRASE,
  });

  const network = networkFromPassphrase(STELLAR_NETWORK_PASSPHRASE);
  const hasError = issues.some((issue) => issue.severity === "error");

  const copyContractId = async () => {
    try {
      await navigator.clipboard.writeText(contractId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the id is shown in full below anyway.
    }
  };

  return (
    <div
      className={`rounded-lg border px-4 py-3 text-xs ${
        hasError
          ? "border-[#F5656555] bg-[#F5656514]"
          : "border-[#2A3338] bg-[#0A0F11]"
      } ${className}`}
      role={hasError ? "alert" : "status"}
      data-testid="network-banner"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-semibold uppercase tracking-wider text-[#33C5E0]">
          {network === "unknown" ? "Custom network" : `Stellar ${network}`}
        </span>

        {contractId ? (
          <>
            <code
              className="font-mono text-[#92A5A8]"
              title={contractId}
              data-testid="network-banner-contract"
            >
              {shortenContractId(contractId)}
            </code>

            <button
              type="button"
              onClick={copyContractId}
              aria-label="Copy contract id"
              className="text-[#92A5A8] hover:text-white transition-colors"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>

            <a
              href={stellarExpertContractUrl(contractId)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-[#33C5E0] hover:text-cyan-300 transition-colors"
            >
              Stellar Expert
              <ExternalLink size={12} />
            </a>
          </>
        ) : (
          <span className="text-[#92A5A8]">No contract configured</span>
        )}
      </div>

      {issues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {issues.map((issue) => (
            <li
              key={issue.message}
              className={`flex items-start gap-1.5 ${
                issue.severity === "error" ? "text-[#F56565]" : "text-[#F5A623]"
              }`}
            >
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
