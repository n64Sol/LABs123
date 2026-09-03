import { isAddress } from "viem";

export type RobinhoodEnvironment = "mainnet" | "testnet";

export interface RobinhoodNetworkConfig {
  name: string;
  environment: RobinhoodEnvironment;
  chainId: number;
  chainIdHex: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: {
    name: "Ether";
    symbol: "ETH";
    decimals: 18;
  };
}

const environment: RobinhoodEnvironment =
  process.env.ROBINHOOD_CHAIN_ENV === "mainnet" ||
  (process.env.ROBINHOOD_CHAIN_ENV !== "testnet" && process.env.NODE_ENV === "production")
    ? "mainnet"
    : "testnet";

const chainId = environment === "mainnet" ? 4663 : 46630;

export const ROBINHOOD_NETWORK: RobinhoodNetworkConfig = {
  name: environment === "mainnet" ? "Robinhood Chain" : "Robinhood Chain Testnet",
  environment,
  chainId,
  chainIdHex: `0x${chainId.toString(16)}`,
  rpcUrl:
    environment === "mainnet"
      ? "https://rpc.mainnet.chain.robinhood.com"
      : "https://rpc.testnet.chain.robinhood.com",
  explorerUrl:
    environment === "mainnet"
      ? "https://robinhoodchain.blockscout.com"
      : "https://explorer.testnet.chain.robinhood.com",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

export const ROBINHOOD_SETTLEMENT_MODE = "custodial_ledger" as const;

export const ROBINHOOD_TOKEN_CONTRACTS = {
  labToken: process.env.ROBINHOOD_LAB_TOKEN_ADDRESS ?? null,
  usdc: process.env.ROBINHOOD_USDC_ADDRESS ?? null,
} as const;

export const ROBINHOOD_TREASURY_ADDRESS =
  process.env.ROBINHOOD_TREASURY_ADDRESS ?? null;

export const MOCK_WALLET_AUTH_ENABLED =
  process.env.NODE_ENV !== "production" &&
  process.env.ALLOW_MOCK_WALLET_AUTH === "true";

export function normalizeEvmAddress(value: string): string | null {
  const address = value.trim();
  return isAddress(address) ? address.toLowerCase() : null;
}

export function isConfiguredEvmAddress(value: string | null): boolean {
  return value == null || isAddress(value);
}

export function robinhoodConfigDto() {
  return {
    network: ROBINHOOD_NETWORK.name,
    environment: ROBINHOOD_NETWORK.environment,
    chainId: ROBINHOOD_NETWORK.chainId,
    chainIdHex: ROBINHOOD_NETWORK.chainIdHex,
    rpcUrl: ROBINHOOD_NETWORK.rpcUrl,
    explorerUrl: ROBINHOOD_NETWORK.explorerUrl,
    nativeCurrency: ROBINHOOD_NETWORK.nativeCurrency,
    settlementMode: ROBINHOOD_SETTLEMENT_MODE,
    tokenContracts: ROBINHOOD_TOKEN_CONTRACTS,
    treasuryAddress: ROBINHOOD_TREASURY_ADDRESS,
    mockWalletAuthEnabled: MOCK_WALLET_AUTH_ENABLED,
  };
}
