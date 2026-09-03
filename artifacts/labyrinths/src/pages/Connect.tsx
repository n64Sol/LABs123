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
  providers?: Eip1193Provider[];
  isBraveWallet?: boolean;
  isCoinbaseWallet?: boolean;
  isMetaMask?: boolean;
  isPhantom?: boolean;
  isRabby?: boolean;
}

function isEip1193Provider(value: unknown): value is Eip1193Provider {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { request?: unknown }).request === "function"
  );
}

interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface DiscoveredWallet {
  id: string;
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
}

type WalletConnectionStatus = "checking" | "connected" | "available";

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    coinbaseWalletExtension?: Eip1193Provider;
    phantom?: {
      ethereum?: Eip1193Provider;
    };
    rabby?: Eip1193Provider;
    okxwallet?: Eip1193Provider;
    trustwallet?: Eip1193Provider;
    BinanceChain?: Eip1193Provider;
  }
}

function legacyProviders(): Eip1193Provider[] {
  if (typeof window === "undefined") return [];
  const injectedProviders: unknown[] = [
    ...(Array.isArray(window.ethereum?.providers) && window.ethereum.providers.length
      ? window.ethereum.providers
      : window.ethereum
        ? [window.ethereum]
        : []),
    ...(window.coinbaseWalletExtension ? [window.coinbaseWalletExtension] : []),
    ...(window.phantom?.ethereum ? [window.phantom.ethereum] : []),
    ...(window.rabby ? [window.rabby] : []),
    ...(window.okxwallet ? [window.okxwallet] : []),
    ...(window.trustwallet ? [window.trustwallet] : []),
    ...(window.BinanceChain ? [window.BinanceChain] : []),
  ];
  const providers = injectedProviders.filter(isEip1193Provider);
  return providers.filter(
    (provider, index) => providers.findIndex((candidate) => candidate === provider) === index,
  );
}

function legacyProviderName(provider: Eip1193Provider, index: number): string {
  if (provider.isPhantom || provider === window.phantom?.ethereum) return "Phantom";
  if (provider.isCoinbaseWallet || provider === window.coinbaseWalletExtension) {
    return "Coinbase Wallet";
  }
  if (provider.isRabby || provider === window.rabby) return "Rabby";
  if (provider === window.okxwallet) return "OKX Wallet";
  if (provider === window.trustwallet) return "Trust Wallet";
  if (provider === window.BinanceChain) return "Binance Wallet";
  if (provider.isMetaMask) return "MetaMask";
  if (provider.isBraveWallet) return "Brave Wallet";
  return index === 0 ? "Browser wallet" : `Browser wallet ${index + 1}`;
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
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [connectedProvider, setConnectedProvider] = useState<Eip1193Provider | null>(null);
  const [walletStatuses, setWalletStatuses] = useState<
    Record<string, WalletConnectionStatus>
  >({});
  const [discoveryVersion, setDiscoveryVersion] = useState(0);
  const [isEmbedded, setIsEmbedded] = useState(false);
  const [currentUrl, setCurrentUrl] = useState("");

  useEffect(() => {
    try {
      setIsEmbedded(window.self !== window.top);
    } catch {
      setIsEmbedded(true);
    }
    setCurrentUrl(window.location.href);
  }, []);

  useEffect(() => {
    const addWallet = (wallet: DiscoveredWallet) => {
      setWallets((current) => {
        const existingIndex = current.findIndex(
          (existing) =>
            existing.id === wallet.id || existing.provider === wallet.provider,
        );
        if (existingIndex >= 0) {
          const existing = current[existingIndex];
          if (existing?.id.startsWith("legacy-") && !wallet.id.startsWith("legacy-")) {
            return current.map((item, index) => (index === existingIndex ? wallet : item));
          }
          return current;
        }
        return [...current, wallet];
      });
    };

    const handleAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<{
        info?: Eip6963ProviderInfo;
        provider?: unknown;
      }>).detail;
      if (!isEip1193Provider(detail?.provider) || !detail.info?.uuid || !detail.info.name) {
        return;
      }
      addWallet({
        id: detail.info.uuid,
        info: detail.info,
        provider: detail.provider,
      });
    };

    window.addEventListener("eip6963:announceProvider", handleAnnounce);
    const requestWallets = () => {
      legacyProviders().forEach((provider, index) => {
        const name = legacyProviderName(provider, index);
        addWallet({
          id: `legacy-${name.toLowerCase().replaceAll(" ", "-")}-${index}`,
          info: {
            uuid: `legacy-${name}-${index}`,
            name,
            icon: "",
            rdns: "",
          },
          provider,
        });
      });
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    };
    requestWallets();
    window.addEventListener("focus", requestWallets);
    document.addEventListener("visibilitychange", requestWallets);
    return () => {
      window.removeEventListener("eip6963:announceProvider", handleAnnounce);
      window.removeEventListener("focus", requestWallets);
      document.removeEventListener("visibilitychange", requestWallets);
    };
  }, [discoveryVersion]);

  useEffect(() => {
    let cancelled = false;
    if (wallets.length === 0) return;

    setWalletStatuses((current) =>
      Object.fromEntries(
        wallets.map((wallet) => [wallet.id, current[wallet.id] ?? "checking"]),
      ),
    );

    void Promise.all(
      wallets.map(async (wallet) => {
        try {
          const accounts = await wallet.provider.request({ method: "eth_accounts" });
          return {
            id: wallet.id,
            status: firstAddress(accounts) ? ("connected" as const) : ("available" as const),
          };
        } catch {
          return { id: wallet.id, status: "available" as const };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setWalletStatuses((current) => ({
        ...current,
        ...Object.fromEntries(results.map((result) => [result.id, result.status])),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [wallets]);

  useEffect(() => {
    const provider = connectedProvider;
    if (!provider?.on) return;

    const handleAccountsChanged = async (...args: unknown[]) => {
      const nextAddress = firstAddress(args[0]);
      if (connectedAddress && nextAddress?.toLowerCase() !== connectedAddress.toLowerCase()) {
        await logout.mutateAsync(undefined).catch(() => undefined);
        queryClient.removeQueries({ queryKey: getGetCurrentPlayerQueryKey() });
        setConnectedAddress(null);
        const connectedWallet = wallets.find((wallet) => wallet.provider === provider);
        if (connectedWallet) {
          setWalletStatuses((current) => ({
            ...current,
            [connectedWallet.id]: "available",
          }));
        }
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
  }, [
    config?.chainId,
    config?.network,
    connectedAddress,
    connectedProvider,
    logout,
    queryClient,
    wallets,
  ]);

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

  const preferredWallet =
    wallets.find((wallet) => wallet.id === selectedWalletId) ??
    wallets.find((wallet) => walletStatuses[wallet.id] === "connected") ??
    wallets[0];
  const selectedProvider = preferredWallet?.provider ?? legacyProviders()[0];

  const openWalletPage = () => {
    const url = currentUrl || window.location.href;
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      setError("Your browser blocked the new tab. Use the link below to open the wallet page.");
    }
  };

  const handleConnect = async (providerOverride?: Eip1193Provider) => {
    const provider = providerOverride ?? selectedProvider;
    setError(null);
    if (!isEip1193Provider(provider)) {
      if (isEmbedded) {
        openWalletPage();
        return;
      }
      setError(
        "No browser wallet was injected into this tab. Open the page in a normal browser tab and try again.",
      );
      return;
    }
    if (!config) {
      setError(
        configLoading
          ? "Network configuration is still loading. Try again in a moment."
          : "Unable to load the Robinhood Chain configuration. Refresh and try again.",
      );
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
      setConnectedProvider(provider);
      const connectedWallet = wallets.find((wallet) => wallet.provider === provider);
      if (connectedWallet) {
        setSelectedWalletId(connectedWallet.id);
        setWalletStatuses((current) => ({
          ...current,
          [connectedWallet.id]: "connected",
        }));
      }
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
  const hasProvider = Boolean(selectedProvider);
  const commonWallets = [
    { name: "Robinhood Wallet", href: "https://robinhood.com/web3-wallet/" },
    { name: "MetaMask", href: "https://metamask.io/download/" },
    { name: "Coinbase Wallet", href: "https://www.coinbase.com/wallet/downloads" },
  ];

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

          {wallets.length > 0 && (
            <div className="space-y-2">
              <label
                htmlFor="wallet-provider"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Choose a wallet
              </label>
              <select
                id="wallet-provider"
                value={selectedWalletId ?? preferredWallet?.id ?? ""}
                onChange={(event) => setSelectedWalletId(event.target.value)}
                disabled={busy}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {wallets.map((wallet) => {
                  const status = walletStatuses[wallet.id];
                  const statusLabel =
                    status === "connected"
                      ? "Connected"
                      : status === "checking"
                        ? "Checking…"
                        : "Not connected";
                  return (
                    <option key={wallet.id} value={wallet.id}>
                      {wallet.info.name} — {statusLabel}
                    </option>
                  );
                })}
              </select>
              <p className="text-xs text-muted-foreground">
                Selecting a wallet does not open a prompt. Click Connect wallet when ready.
              </p>
            </div>
          )}

          <Button
            className="w-full h-12 text-base"
            onClick={
              isEmbedded && !hasProvider
                ? openWalletPage
                : () => {
                    void handleConnect();
                  }
            }
            disabled={busy}
          >
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wallet className="w-4 h-4 mr-2" />}
            {busy
              ? "Waiting for wallet…"
              : hasProvider
                ? "Connect wallet"
                : isEmbedded
                  ? "Open wallet connection in a new tab"
                  : "Install a browser wallet"}
          </Button>

          {!hasProvider && (
            <div className="space-y-2">
              <div className="text-center text-xs text-muted-foreground">
                {isEmbedded
                  ? "Wallet extensions may not inject into the embedded preview."
                  : "Install any EVM wallet to continue"}
              </div>
              {isEmbedded && currentUrl && (
                <a
                  href={currentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-center text-sm font-medium text-primary hover:bg-primary/10"
                >
                  Open the connect page in a new tab
                </a>
              )}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setDiscoveryVersion((version) => version + 1)}
                disabled={busy}
              >
                Refresh wallet detection
              </Button>
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                {commonWallets.map((wallet) => (
                  <a
                    key={wallet.name}
                    href={wallet.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                  >
                    {wallet.name} <ExternalLink className="w-3 h-3" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Robinhood Chain is an EVM network. If your wallet is elsewhere, the app will offer to switch or add the configured network.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}