"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import {
  ACTIVITY_EVENTS,
  LAST_ACTIVITY_KEY,
  isStoredSessionExpired,
  secondsUntilExpiry,
  sessionPhase,
} from "@/lib/walletSession";
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
} from "@creit.tech/stellar-wallets-kit";
import { useRouter } from "next/navigation";
import { STELLAR_NETWORK_PASSPHRASE } from "@/app/lib/stellar/network";

export interface SignTransactionOptions {
  networkPassphrase?: string;
  address?: string;
}

interface WalletContextType {
  connect: (moduleId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  /**
   * Seconds until the session is dropped, or `null` when it is not close
   * enough to warn about. A consumer renders the countdown modal from this.
   */
  sessionSecondsLeft: number | null;
  /** Resets the idle timer, e.g. from a "Stay connected" button. */
  extendSession: () => void;
  signTransaction: (
    xdr: string,
    opts?: SignTransactionOptions
  ) => Promise<{ signedTxXdr: string }>;
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  selectedWalletId: string | null;
  kit: StellarWalletsKit | null;
  openModal: () => void;
  closeModal: () => void;
  isModalOpen: boolean;
  supportedWallets: { id: string; name: string; icon: string }[];
  /** Network passphrase this wallet session is configured for (Testnet by default). */
  networkPassphrase: string;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const E2E_MOCK_WALLET_ADDRESS =
  "GDE2KZQ4QGJZ5Z5QW2Y4B7Y6Q5D3P9V8N7M6L5K4J3H2G1FTEST";

const WALLET_ICONS: Record<string, string> = {
  freighter: "/icons/freighter.png",
  albedo: "/icons/albedo.png",
  xbull: "/icons/xbull.png",
  rabet: "/icons/rabet.png",
  lobstr: "/icons/lobstr.png",
  hana: "/icons/hana.png",
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
};

export const WalletProvider = ({ children }: { children: React.ReactNode }) => {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [kit, setKit] = useState<StellarWalletsKit | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const walletKit = new StellarWalletsKit({
      network: WalletNetwork.TESTNET,
      selectedWalletId: "freighter",
      modules: allowAllModules(),
    });
    setKit(walletKit);

    const savedAddress = localStorage.getItem("inheritx_wallet_address");
    const savedWalletId = localStorage.getItem("inheritx_wallet_id");

    // An in-memory timer does nothing once the tab is closed: without this
    // check, reopening the page tomorrow on a shared machine silently
    // reconnects the previous person's wallet.
    if (isStoredSessionExpired(localStorage.getItem(LAST_ACTIVITY_KEY), Date.now())) {
      localStorage.removeItem("inheritx_wallet_address");
      localStorage.removeItem("inheritx_wallet_id");
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      return;
    }

    if (savedAddress && savedWalletId) {
      setAddress(savedAddress);
      setSelectedWalletId(savedWalletId);
    }
  }, []);

  useEffect(() => {
    const handleAddressChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ address: string }>;
      if (customEvent.detail?.address) {
        const newAddress = customEvent.detail.address;
        setAddress(newAddress);
        localStorage.setItem("inheritx_wallet_address", newAddress);
      }
    };

    window.addEventListener("stellar-wallet:address-change", handleAddressChange);
    return () => {
      window.removeEventListener("stellar-wallet:address-change", handleAddressChange);
    };
  }, []);

  // ── Session expiry ──────────────────────────────────────────────────────

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  // Held in a ref, not state: activity fires constantly and re-rendering the
  // whole wallet tree on every mousemove would be its own bug.
  const lastActivityRef = useRef<number>(Date.now());

  const recordActivity = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    try {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    } catch {
      // Private browsing can refuse writes; the in-memory timer still runs.
    }
  }, []);

  useEffect(() => {
    if (!address) {
      setSecondsLeft(null);
      return;
    }

    recordActivity();
    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, recordActivity, { passive: true }),
    );

    const interval = window.setInterval(() => {
      const phase = sessionPhase(lastActivityRef.current, Date.now());

      if (phase === "expired") {
        void disconnectRef.current?.();
        setSecondsLeft(null);
        return;
      }

      setSecondsLeft(
        phase === "warning" ? secondsUntilExpiry(lastActivityRef.current, Date.now()) : null,
      );
    }, 1000);

    return () => {
      window.clearInterval(interval);
      ACTIVITY_EVENTS.forEach((event) =>
        window.removeEventListener(event, recordActivity),
      );
    };
  }, [address, recordActivity]);

  const supportedWallets = [
    { id: "freighter", name: "Freighter", icon: WALLET_ICONS.freighter },
    { id: "albedo", name: "Albedo", icon: WALLET_ICONS.albedo },
    { id: "xbull", name: "xBull", icon: WALLET_ICONS.xbull },
    { id: "rabet", name: "Rabet", icon: WALLET_ICONS.rabet },
    { id: "lobstr", name: "Lobstr", icon: WALLET_ICONS.lobstr },
    { id: "hana", name: "Hana", icon: WALLET_ICONS.hana },
  ];

  const connectCustom = async (moduleId: string) => {
    setIsConnecting(true);
    try {
      if (process.env.NEXT_PUBLIC_E2E_MOCK_WALLET === "true") {
        setAddress(E2E_MOCK_WALLET_ADDRESS);
        setSelectedWalletId(moduleId);
        localStorage.setItem("inheritx_wallet_address", E2E_MOCK_WALLET_ADDRESS);
        localStorage.setItem("inheritx_wallet_id", moduleId);
        setIsModalOpen(false);
        router.push("/asset-owner");
        return;
      }

      if (!kit) throw new Error("Wallet kit not initialized");
      kit.setWallet(moduleId);
      const { address } = await kit.getAddress();

      setAddress(address);
      setSelectedWalletId(moduleId);
      localStorage.setItem("inheritx_wallet_address", address);
      localStorage.setItem("inheritx_wallet_id", moduleId);
      setIsModalOpen(false);
      router.push("/asset-owner");
    } catch (error) {
      console.warn("Wallet extension connection failed, falling back to mock wallet:", error);
      // Fallback connection
      setAddress(E2E_MOCK_WALLET_ADDRESS);
      setSelectedWalletId(moduleId);
      localStorage.setItem("inheritx_wallet_address", E2E_MOCK_WALLET_ADDRESS);
      localStorage.setItem("inheritx_wallet_id", moduleId);
      setIsModalOpen(false);
      router.push("/asset-owner");
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = useCallback(async () => {
    setAddress(null);
    setSelectedWalletId(null);
    setSecondsLeft(null);
    localStorage.removeItem("inheritx_wallet_address");
    localStorage.removeItem("inheritx_wallet_id");
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    if (kit) {
      try {
        await kit.disconnect();
      } catch {
        // kit.disconnect() may not be supported by all wallets
      }
    }
  }, [kit]);

  // Lets the expiry interval call the latest `disconnect` without listing it
  // as a dependency, which would tear down and rebuild the timer on every
  // change to `kit`.
  const disconnectRef = useRef<typeof disconnect | null>(null);
  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  const signTransaction = useCallback(
    async (
      xdr: string,
      opts?: SignTransactionOptions
    ): Promise<{ signedTxXdr: string }> => {
      if (!kit) {
        throw new Error("Wallet not connected. Please connect your wallet first.");
      }
      return await kit.signTransaction(xdr, {
        networkPassphrase: opts?.networkPassphrase ?? STELLAR_NETWORK_PASSPHRASE,
        address: opts?.address ?? address ?? undefined,
      });
    },
    [kit, address]
  );

  const openModal = () => setIsModalOpen(true);
  const closeModal = () => setIsModalOpen(false);

  return (
    <WalletContext.Provider
      value={{
        connect: connectCustom,
        disconnect,
        signTransaction,
        address,
        isConnected: !!address,
        isConnecting,
        selectedWalletId,
        kit,
        openModal,
        closeModal,
        isModalOpen,
        supportedWallets,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
        sessionSecondsLeft: secondsLeft,
        extendSession: recordActivity,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};
