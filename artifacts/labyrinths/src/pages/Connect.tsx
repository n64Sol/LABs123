import {
  getGetCurrentPlayerQueryKey,
  useGetAuthConfig,
  useLogout,
  useRequestAuthChallenge,
  useVerifyAuthChallenge,
} from "@workspace/api-client-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, Key, Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

function currentProvider(): Eip1193Provider | undefined {
  return typeof window !== "undefined" ? window.ethereum : undefined;
}

function firstAddress(value: unknown): string | null {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
}

function chainIdFromProvider(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const chainId = Number(value);
  return Number.isInteger(chainId) ? chainId : null;
}

export default function Connect() {
  const { data: config, isLoading: configLoading } = useGetAuthConfig();
  const requestChallenge = useRequestAuthChallenge();
  const verifyChallenge = useVerifyAuthChallenge();
  const logout = useLogout();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    const provider = currentProvider();
    if (!provider?.on) return;

    const handleAccountsChanged = async (...args: unknown[]) => {
      const nextAddress = firstAddress(args[0]);
      if (connectedAddress && nextAddress?.toLowerCase() !== connectedAddress.toLowerCase()) {
        await logout.mutateAsync(undefined).catch(() => undefined);
        queryClient.removeQueries({ queryKey: getGetCurrentPlayerQueryKey() });
        setConnectedAddress(null);
        setError("Wallet account changed. Sign in again to continue.");
      }
    };
    const handleChainChanged = async (...args: unknown[]) => {
      const nextChainId = chainIdFromProvider(args[0]);
      if (nextChainId !== config?.chainId && connectedAddress) {
        await logout.mutateAsync(undefined).catch(() => undefined);
        queryClient.removeQueries({ queryKey: getGetCurrentPlayerQueryKey() });
        setConnectedAddress(null);
        setError(`Switch back to ${config?.network ?? "Robinhood Chain"} to continue.`);
      }
    };

    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("chainChanged", handleChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
      provider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [config?.chainId, config?.network, connectedAddress, logout, queryClient]);

  const ensureNetwork = async (provider: Eip1193Provider): Promise<number> => {
    if (!config) throw new Error("Robinhood Chain configuration is still loading.");
    const chainId = chainIdFromProvider(await provider.request({ method: "eth_chainId" }));
    if (chainId === config.chainId) return chainId;

    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: config.chainIdHex }],
      });
    } catch (switchError) {
      const code =
        switchError && typeof switchError === "object" && "code" in switchError
          ? (switchError as { code?: number }).code
          : undefined;
      if (code !== 4902) throw new Error(`Please switch your wallet to ${config.network}.`);
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: config.chainIdHex,
            chainName: config.network,
            nativeCurrency: config.nativeCurrency,
            rpcUrls: [config.rpcUrl],
            blockExplorerUrls: [config.explorerUrl],
          },
        ],
      });
    }

    const switchedChainId = chainIdFromProvider(await provider.request({ method: "eth_chainId" }));
    if (switchedChainId !== config.chainId) {
      throw new Error(`Please switch your wallet to ${config.network}.`);
    }
    return switchedChainId;
  };

  const handleConnect = async () => {
    const provider = currentProvider();
    setError(null);
    if (!provider) {
      setError("No browser wallet detected. Install Robinhood Wallet or MetaMask to continue.");
      return;
    }
    setIsConnecting(true);
    try {
      const address = firstAddress(await provider.request({ method: "eth_requestAccounts" }));
      if (!address) throw new Error("Your wallet did not return an account.");
      const chainId = (await ensureNetwork(provider)) as 4663 | 46630;
      const challenge = await requestChallenge.mutateAsync({
        data: { walletAddress: address, chainId },
      });
      const signature = await provider.request({
        method: "personal_sign",
        params: [challenge.message, address],
      });
      if (typeof signature !== "string") throw new Error("Your wallet did not return a signature.");
      await verifyChallenge.mutateAsync({
        data: {
          walletAddress: address,
          chainId,
          message: challenge.message,
          signature,
        },
      });
      setConnectedAddress(address);
      queryClient.invalidateQueries({ queryKey: getGetCurrentPlayerQueryKey() });
      setLocation("/");
    } catch (connectError) {
      const message =
        connectError instanceof Error ? connectError.message : "Wallet sign-in was cancelled.";
      setError(message);
      toast.error(message);
    } finally {
      setIsConnecting(false);
    }
  };

  const busy =
    isConnecting || requestChallenge.isPending || verifyChallenge.isPending || logout.isPending;
  const hasProvider = Boolean(currentProvider());

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 blur-[100px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/20 blur-[100px] rounded-full pointer-events-none" />

      <Card className="w-full max-w-md relative z-10 border-primary/20 shadow-2xl backdrop-blur-sm bg-card/95">
        <CardHeader className="text-center space-y-4">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-2 text-primary">
            <Key className="w-8 h-8" />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight text-foreground">
            Enter the Labyrinths
          </CardTitle>
          <CardDescription className="text-base text-muted-foreground">
            Connect an EVM wallet and sign a one-time message. No transaction or token approval is requested.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-2 font-semibold">
              <Wallet className="w-4 h-4 text-primary" />
              {configLoading ? "Loading network…" : config?.network ?? "Robinhood Chain"}
              {config && <CheckCircle2 className="ml-auto w-4 h-4 text-emerald-600" />}
            </div>
            {config && (
              <div className="mt-2 text-xs text-muted-foreground space-y-1">
                <div>Chain ID: {config.chainId}</div>
                <div>
                  Settlement:{" "}
                  {config.settlementMode === "custodial_ledger"
                    ? "server-authoritative integer ledger"
                    : "on-chain"}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <Button
            className="w-full h-12 text-base"
            onClick={handleConnect}
            disabled={busy || configLoading || !config}
          >
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wallet className="w-4 h-4 mr-2" />}
            {busy ? "Waiting for wallet…" : hasProvider ? "Connect wallet" : "Install a browser wallet"}
          </Button>

          {!hasProvider && (
            <a
              href="https://robinhood.com/web3-wallet/"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-primary"
            >
              Get Robinhood Wallet <ExternalLink className="w-3 h-3" />
            </a>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Robinhood Chain is an EVM network. If your wallet is elsewhere, the app will offer to switch or add the configured network.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}