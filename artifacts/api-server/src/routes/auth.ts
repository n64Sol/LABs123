import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { usersTable, authChallengesTable, authSessionsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { recoverMessageAddress } from "viem";
import { MOCK_WALLETS } from "../lib/catalog";
import {
  createSession,
  setSessionCookie,
  clearSessionCookie,
  newToken,
  requireAuth,
  getUserFromRequest,
  SESSION_COOKIE,
} from "../lib/auth";
import { buildPlayerDto } from "../lib/dto";
import { getBalancesDto } from "../lib/balances";
import {
  MOCK_WALLET_AUTH_ENABLED,
  ROBINHOOD_NETWORK,
  normalizeEvmAddress,
  robinhoodConfigDto,
} from "../lib/robinhood";

const router: IRouter = Router();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function challengeMessage(walletAddress: string, nonce: string, chainId: number): string {
  return [
    "Labyrinths wants you to sign in with your Robinhood Chain account:",
    walletAddress,
    "",
    "Welcome to the luminous overworld.",
    "",
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    "Please sign this message to authenticate. It does not authorize a transaction.",
  ].join("\n");
}

function parseChainId(value: unknown): number | null {
  const chainId = typeof value === "string" ? Number(value) : Number(value);
  return Number.isInteger(chainId) ? chainId : null;
}

router.get("/auth/config", async (_req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  res.json(robinhoodConfigDto());
});

router.get("/auth/mock-wallets", async (_req: Request, res: Response): Promise<void> => {
  if (!MOCK_WALLET_AUTH_ENABLED) {
    res.status(404).json({ error: "Development wallet fixtures are disabled" });
    return;
  }
  res.json(
    MOCK_WALLETS.map((w) => ({
      walletAddress: w.walletAddress,
      displayName: w.displayName,
      avatarUrl: w.avatarUrl,
      isPrimary: w.isPrimary,
      tagline: w.tagline,
    })),
  );
});

router.post("/auth/challenge", async (req: Request, res: Response): Promise<void> => {
  const walletAddress = normalizeEvmAddress(String(req.body?.walletAddress ?? ""));
  const chainId = parseChainId(req.body?.chainId);
  if (!walletAddress) {
    res.status(400).json({ error: "A valid EVM wallet address is required" });
    return;
  }
  if (chainId !== ROBINHOOD_NETWORK.chainId) {
    res.status(409).json({
      error: `Switch your wallet to ${ROBINHOOD_NETWORK.name} before signing in`,
      expectedChainId: ROBINHOOD_NETWORK.chainId,
      expectedChainIdHex: ROBINHOOD_NETWORK.chainIdHex,
    });
    return;
  }

  const nonce = newToken("nonce_");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + CHALLENGE_TTL_MS);
  await db.insert(authChallengesTable).values({
    walletAddress,
    chainId,
    nonce,
    createdAt,
    expiresAt,
  });
  res.json({
    walletAddress,
    chainId,
    nonce,
    expiresAt: expiresAt.toISOString(),
    message: challengeMessage(walletAddress, nonce, chainId),
  });
});

router.post("/auth/verify", async (req: Request, res: Response): Promise<void> => {
  const walletAddress = normalizeEvmAddress(String(req.body?.walletAddress ?? ""));
  const chainId = parseChainId(req.body?.chainId);
  const message = String(req.body?.message ?? "");
  const signature = String(req.body?.signature ?? "").trim();
  if (!walletAddress || !message || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    res.status(401).json({ error: "Invalid EVM signature" });
    return;
  }
  if (chainId !== ROBINHOOD_NETWORK.chainId) {
    res.status(409).json({
      error: `Switch your wallet to ${ROBINHOOD_NETWORK.name} before signing in`,
      expectedChainId: ROBINHOOD_NETWORK.chainId,
      expectedChainIdHex: ROBINHOOD_NETWORK.chainIdHex,
    });
    return;
  }

  const challenges = await db
    .select()
    .from(authChallengesTable)
    .where(
      and(
        eq(authChallengesTable.walletAddress, walletAddress),
        eq(authChallengesTable.chainId, chainId),
        eq(authChallengesTable.consumed, false),
      ),
    )
    .orderBy(desc(authChallengesTable.createdAt))
    .limit(1);
  const challenge = challenges[0];
  if (!challenge || challenge.expiresAt.getTime() <= Date.now()) {
    res.status(401).json({ error: "Invalid or expired sign-in challenge" });
    return;
  }

  const expectedMessage = challengeMessage(walletAddress, challenge.nonce, challenge.chainId);
  if (message !== expectedMessage) {
    res.status(401).json({ error: "Signed message does not match the issued challenge" });
    return;
  }

  let recoveredAddress: string;
  try {
    recoveredAddress = (await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    })).toLowerCase();
  } catch {
    res.status(401).json({ error: "Unable to recover the signing wallet" });
    return;
  }
  if (recoveredAddress !== walletAddress) {
    res.status(401).json({ error: "Signature does not belong to this wallet" });
    return;
  }

  // Consume only after all checks pass, and make the transition conditional so
  // concurrent verification requests cannot both establish a session.
  const consumed = await db
    .update(authChallengesTable)
    .set({ consumed: true })
    .where(
      and(
        eq(authChallengesTable.id, challenge.id),
        eq(authChallengesTable.consumed, false),
      ),
    )
    .returning({ id: authChallengesTable.id });
  if (consumed.length === 0) {
    res.status(401).json({ error: "Challenge already used; please reconnect" });
    return;
  }

  let users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.walletAddress, walletAddress))
    .limit(1);
  let user = users[0];
  if (!user) {
    const seed = MOCK_WALLET_AUTH_ENABLED
      ? MOCK_WALLETS.find((w) => w.walletAddress.toLowerCase() === walletAddress)
      : undefined;
    const inserted = await db
      .insert(usersTable)
      .values({
        walletAddress,
        walletChainId: chainId,
        displayName: seed?.displayName ?? `Adventurer-${walletAddress.slice(2, 6)}`,
        avatarUrl:
          seed?.avatarUrl ??
          `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(walletAddress)}`,
        tagline: seed?.tagline ?? "A new wanderer",
        isPrimary: seed?.isPrimary ?? false,
        isGuest: seed?.isGuest ?? false,
      })
      .returning();
    user = inserted[0]!;
    const { ensureBalances, addCurrency } = await import("../lib/balances");
    await ensureBalances(user.id);
    await addCurrency(user.id, { gold: 500, labToken: 50, ore: 20, dust: 20, keys: 2 });
  } else if (user.walletChainId !== chainId) {
    await db
      .update(usersTable)
      .set({ walletChainId: chainId })
      .where(eq(usersTable.id, user.id));
    user = { ...user, walletChainId: chainId };
  }

  const token = await createSession(user.id);
  setSessionCookie(res, token);
  const dto = await buildPlayerDto(user);
  res.json(dto);
});

router.get("/auth/me", async (req: Request, res: Response): Promise<void> => {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const dto = await buildPlayerDto(user);
  res.json(dto);
});

router.post("/auth/logout", async (req: Request, res: Response): Promise<void> => {
  const token = (req.cookies?.[SESSION_COOKIE] as string | undefined) ?? undefined;
  if (token) {
    await db.delete(authSessionsTable).where(eq(authSessionsTable.token, token));
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/balances", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const dto = await getBalancesDto(req.user!.id);
  res.json(dto);
});

export default router;