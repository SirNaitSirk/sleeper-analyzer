// Prints personal invite links for the AI advisor.
// Usage: npm run invite -- <sleeper-username> [<username> …]
// Reads INVITE_SECRET and APP_URL from the environment or .env.local.
import { existsSync } from "node:fs";
import { signToken } from "../src/lib/token.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const secret = process.env.INVITE_SECRET;
const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const names = process.argv.slice(2);

if (!secret) {
  console.error("INVITE_SECRET fehlt (in .env.local oder als Umgebungsvariable setzen).");
  process.exit(1);
}
if (!names.length) {
  console.error("Aufruf: npm run invite -- <sleeper-username> [<username> …]");
  process.exit(1);
}

let failed = false;
for (const name of names) {
  const res = await fetch(`https://api.sleeper.app/v1/user/${encodeURIComponent(name)}`);
  const user = res.ok ? ((await res.json()) as { user_id: string; display_name?: string } | null) : null;
  if (!user?.user_id) {
    console.error(`${name}: Sleeper-User nicht gefunden`);
    failed = true;
    continue;
  }
  const url = `${appUrl}/invite?u=${user.user_id}&t=${signToken(secret, user.user_id)}`;
  console.log(`${user.display_name ?? name} (${user.user_id}): ${url}`);
}
process.exit(failed ? 1 : 0);
