import { cookies } from "next/headers";
import { kv, type KV } from "./kv";
import { verifyToken } from "./token";

export const ACCESS_COOKIE = "sa_access";

const list = (v: string | undefined) =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const secret = () => process.env.INVITE_SECRET ?? "";

/** Without an invite secret the advisor is open – allowed only outside production. */
const openMode = () => !secret() && process.env.NODE_ENV !== "production";

/** Empty ALLOWED_LEAGUE_IDS = every league. */
export function leagueAllowed(leagueId: string): boolean {
  const allowed = list(process.env.ALLOWED_LEAGUE_IDS);
  return allowed.length === 0 || allowed.includes(leagueId);
}

export const cookieValue = (userId: string, token: string) => `${userId}.${token}`;

export function parseCookie(value: string | undefined): { userId: string; token: string } | null {
  const i = value?.indexOf(".") ?? -1;
  if (!value || i <= 0) return null;
  return { userId: value.slice(0, i), token: value.slice(i + 1) };
}

/** The Sleeper user ID the visitor proved via their invite link, or null. */
export async function viewerUserId(): Promise<string | null> {
  const c = parseCookie((await cookies()).get(ACCESS_COOKIE)?.value);
  return c && verifyToken(secret(), c.userId, c.token) ? c.userId : null;
}

export type AdvisorAccess =
  | { allowed: true; remaining: number | null }
  | { allowed: false; reason: string };

/** Whether the visitor may use the advisor for `userId`'s team in this league. */
export async function advisorAccess(leagueId: string, userId: string, store: KV = kv): Promise<AdvisorAccess> {
  if (!leagueAllowed(leagueId)) {
    return { allowed: false, reason: "Der KI-Berater ist für diese Liga nicht freigeschaltet." };
  }
  if (!openMode()) {
    if (!secret()) return { allowed: false, reason: "Der KI-Berater ist nicht konfiguriert (INVITE_SECRET fehlt)." };
    if ((await viewerUserId()) !== userId) {
      return { allowed: false, reason: "Der KI-Berater ist nur mit deinem persönlichen Link nutzbar." };
    }
  }
  return { allowed: true, remaining: await remainingQuota(userId, store) };
}

// ---------------- Daily limit ----------------

const dailyLimit = () => {
  const n = Number(process.env.ADVICE_DAILY_LIMIT);
  return Number.isFinite(n) && n >= 0 && process.env.ADVICE_DAILY_LIMIT !== "" ? Math.floor(n) : 3;
};
const unlimited = (userId: string) => list(process.env.ADVICE_ADMIN_USER_IDS).includes(userId);

/** Calendar day in Germany, so the limit resets at midnight local time. */
export const berlinDay = (d = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);

const quotaKey = (userId: string) => `quota:${userId}:${berlinDay()}`;
const DAY_SEC = 36 * 60 * 60;

/** Remaining requests today; null = unlimited. */
export async function remainingQuota(userId: string, store: KV = kv): Promise<number | null> {
  if (unlimited(userId)) return null;
  const used = Number(await store.get(quotaKey(userId))) || 0;
  return Math.max(0, dailyLimit() - used);
}

/**
 * Reserves one request. `ok: false` when today's limit is used up. `refund`
 * gives it back, e.g. when the API call failed before any answer arrived.
 */
export async function consumeQuota(
  userId: string,
  store: KV = kv,
): Promise<{ ok: boolean; remaining: number | null; refund: () => Promise<void> }> {
  if (unlimited(userId)) return { ok: true, remaining: null, refund: async () => {} };
  // Keep the key: a refund after midnight must not touch the next day's counter.
  const key = quotaKey(userId);
  const used = await store.incr(key, DAY_SEC);
  if (used > dailyLimit()) {
    await store.decr(key);
    return { ok: false, remaining: 0, refund: async () => {} };
  }
  let refunded = false;
  const refund = async () => {
    if (refunded) return;
    refunded = true;
    await store.decr(key);
  };
  return { ok: true, remaining: dailyLimit() - used, refund };
}
