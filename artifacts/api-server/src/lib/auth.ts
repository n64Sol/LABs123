import { randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { authSessionsTable, usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";

export const SESSION_COOKIE = "lab_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export function newToken(prefix = ""): string {
  return prefix + randomBytes(24).toString("hex");
}

export async function createSession(userId: number): Promise<string> {
  const token = newToken("sess_");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(authSessionsTable).values({ token, userId, expiresAt });
  return token;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function getUserBySessionToken(
  token: string | undefined | null,
): Promise<User | null> {
  if (!token) return null;
  const rows = await db
    .select()
    .from(authSessionsTable)
    .where(eq(authSessionsTable.token, token))
    .limit(1);
  const session = rows[0];
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;
  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.userId))
    .limit(1);
  return users[0] ?? null;
}

export async function getUserFromRequest(req: Request): Promise<User | null> {
  const token = (req.cookies?.[SESSION_COOKIE] as string | undefined) ?? undefined;
  return getUserBySessionToken(token);
}

/** Parse a raw `Cookie` header (e.g. from a WebSocket upgrade request). */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    // A malformed percent-encoding (e.g. a stray "%") makes decodeURIComponent
    // throw; tolerate it by falling back to the raw value rather than crashing
    // the upgrade/auth path.
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

// Express request augmentation: attaches the authenticated user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.user = user;
  next();
}
