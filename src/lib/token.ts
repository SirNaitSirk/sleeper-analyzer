import { createHmac, timingSafeEqual } from "node:crypto";

// No imports from the app here: `scripts/invite.ts` runs this file directly with Node.

/** Stateless invite token: HMAC of the Sleeper user ID, so nothing has to be stored. */
export function signToken(secret: string, userId: string): string {
  return createHmac("sha256", secret).update(`invite:${userId}`).digest("base64url").slice(0, 32);
}

export function verifyToken(secret: string, userId: string, token: string): boolean {
  if (!secret || !userId || !token) return false;
  const expected = Buffer.from(signToken(secret, userId));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
