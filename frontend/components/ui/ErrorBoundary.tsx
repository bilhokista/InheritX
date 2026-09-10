/**
 * Error Boundary Component
 * Catches and displays errors gracefully
 */

"use client";

import React, { Component, ReactNode } from "react";
import { AlertTriangle, ChevronDown, RefreshCw, Server } from "lucide-react";
import {
  SOROBAN_RPC_URL,
  SOROBAN_RPC_URLS,
} from "@/app/lib/stellar/network";
import {
  MAX_AUTO_RETRIES,
  computeRetryDelay,
  isTransientRpcError,
  nextEndpoint,
  parseRpcEndpoints,
  shouldAutoRetry,
} from "@/app/lib/stellar/rpcHealth";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /**
   * Called when the reader picks a different RPC endpoint. Without it the
   * switcher is hidden, since changing an endpoint nothing listens to would
   * be a button that appears to work and does not.
   */
  onEndpointChange?: (endpoint: string) => void;
  /** Disables the automatic backoff retry. Mainly a seam for tests. */
  autoRetry?: boolean;
}

interface State {
  hasError: boolean;
  error?: Error;
  componentStack?: string;
  /** Automatic retries spent on the current error. */
  retryCount: number;
  isRetrying: boolean;
  showDetails: boolean;
  endpoint: string;
}

export class ErrorBoundary extends Component<Props, State> {
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      retryCount: 0,
      isRetrying: false,
      showDetails: false,
      endpoint: SOROBAN_RPC_URL,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
    this.setState({ componentStack: errorInfo.componentStack ?? undefined });

    // A testnet node returning 504 for a moment should not leave a dead
    // subtree that only a full page reload can revive.
    if (this.props.autoRetry !== false && shouldAutoRetry(error, this.state.retryCount)) {
      this.scheduleRetry();
    }
  }

  componentWillUnmount() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  private scheduleRetry = () => {
    const delay = computeRetryDelay(this.state.retryCount);
    this.setState({ isRetrying: true });
    this.retryTimer = setTimeout(() => {
      // Clearing hasError remounts the subtree, which re-runs whatever
      // request failed. If it fails again, componentDidCatch fires with an
      // incremented count until the budget runs out.
      this.setState((prev) => ({
        hasError: false,
        error: undefined,
        componentStack: undefined,
        isRetrying: false,
        retryCount: prev.retryCount + 1,
      }));
    }, delay);
  };

  /** Manual retry. Resets the budget: the reader has chosen to try again. */
  private handleRetry = () => {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.setState({
      hasError: false,
      error: undefined,
      componentStack: undefined,
      isRetrying: false,
      retryCount: 0,
    });
  };

  private handleSwitchEndpoint = () => {
    const endpoints = parseRpcEndpoints(SOROBAN_RPC_URLS, SOROBAN_RPC_URL);
    const next = nextEndpoint(endpoints, this.state.endpoint);
    this.setState({ endpoint: next });
    this.props.onEndpointChange?.(next);
    this.handleRetry();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, retryCount, isRetrying, showDetails, componentStack } = this.state;
      const transient = isTransientRpcError(error);
      const endpoints = parseRpcEndpoints(SOROBAN_RPC_URLS, SOROBAN_RPC_URL);
      const canSwitch = endpoints.length > 1 && !!this.props.onEndpointChange;

      if (isRetrying) {
        return (
          <div className="min-h-screen flex items-center justify-center p-4">
            <div
              className="bg-[#0A0F11] border border-[#33C5E0]/30 rounded-2xl p-8 max-w-md w-full text-center"
              role="status"
            >
              <RefreshCw className="text-[#33C5E0] mx-auto mb-4 animate-spin" size={32} />
              <p className="text-white">
                Connection problem — retrying ({retryCount + 1} of {MAX_AUTO_RETRIES})
              </p>
            </div>
          </div>
        );
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="bg-[#0A0F11] border border-red-500/30 rounded-2xl p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="text-red-400" size={32} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              {transient ? "Connection problem" : "Something went wrong"}
            </h2>
            <p className="text-[#8899A6] mb-2">
              {transient
                ? "The Soroban RPC node did not respond. This is usually temporary on testnet."
                : error?.message || "An unexpected error occurred"}
            </p>

            {transient && retryCount >= MAX_AUTO_RETRIES && (
              <p className="text-[#8899A6]/70 text-sm mb-4">
                Retried {MAX_AUTO_RETRIES} times without success.
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
              <button
                onClick={this.handleRetry}
                className="bg-[#33C5E0] text-[#161E22] px-6 py-3 rounded-full font-medium flex items-center gap-2 justify-center hover:bg-[#2AB5D0] transition-colors"
              >
                <RefreshCw size={20} />
                Try again
              </button>

              {canSwitch && (
                <button
                  onClick={this.handleSwitchEndpoint}
                  className="border border-[#33C5E0]/40 text-[#33C5E0] px-6 py-3 rounded-full font-medium flex items-center gap-2 justify-center hover:bg-[#33C5E0]/10 transition-colors"
                >
                  <Server size={20} />
                  Switch RPC node
                </button>
              )}

              {/* Kept as a last resort rather than the only option: a reload
                  throws away all client state for what is often a blip. */}
              <button
                onClick={() => window.location.reload()}
                className="text-[#8899A6] px-6 py-3 rounded-full font-medium hover:text-white transition-colors"
              >
                Reload page
              </button>
            </div>

            {(error?.stack || componentStack) && (
              <div className="mt-6 text-left">
                <button
                  onClick={() => this.setState((prev) => ({ showDetails: !prev.showDetails }))}
                  aria-expanded={showDetails}
                  className="text-[#8899A6] text-sm flex items-center gap-1 hover:text-white transition-colors"
                >
                  <ChevronDown
                    size={16}
                    className={showDetails ? "rotate-180 transition-transform" : "transition-transform"}
                  />
                  Technical details
                </button>

                {showDetails && (
                  <div className="mt-3 bg-black/40 border border-[#161E22] rounded-lg p-3 max-h-64 overflow-auto">
                    <p className="text-[#8899A6] text-xs mb-2 break-all">
                      RPC endpoint: {this.state.endpoint}
                    </p>
                    <pre className="text-[#8899A6] text-xs whitespace-pre-wrap break-all">
                      {error?.stack ?? error?.message}
                      {componentStack}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Simple Error Display Component
 */
export function ErrorDisplay({
  error,
  onRetry,
}: {
  error: string;
  onRetry?: () => void;
}) {
  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-center">
      <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
        <AlertTriangle className="text-red-400" size={24} />
      </div>
      <p className="text-red-400 mb-4">{error}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="bg-red-500/20 text-red-400 px-4 py-2 rounded-lg hover:bg-red-500/30 transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
}

/**
 * Empty State Component
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}) {
  return (
    <div className="bg-[#0A0F11] border border-[#161E22] rounded-2xl p-12 text-center">
      <h3 className="text-xl font-semibold text-white mb-2">{title}</h3>
      <p className="text-[#8899A6] mb-6 max-w-md mx-auto">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="bg-[#33C5E0] text-[#161E22] px-6 py-3 rounded-full font-medium hover:bg-[#2AB5D0] transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
