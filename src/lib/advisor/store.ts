import { promises as fs } from "node:fs";
import path from "node:path";
import { CACHE_DIR, kv } from "../kv";

export interface SavedAdvice {
  markdown: string;
  question: string | null;
  createdAt: number;
}

const MAX_HISTORY = 200;

const clean = (s: string) => s.replace(/\W/g, "");
const key = (leagueId: string, userId: string) => `advice:${clean(leagueId)}:${clean(userId)}`;

/** Analyses saved before the KV store existed (one JSON file per league/user). */
async function loadLegacy(leagueId: string, userId: string): Promise<SavedAdvice[]> {
  try {
    const file = path.join(CACHE_DIR, "advice", `${clean(leagueId)}_${clean(userId)}.json`);
    const data = JSON.parse(await fs.readFile(file, "utf8")) as SavedAdvice | SavedAdvice[];
    return Array.isArray(data) ? data : [data];
  } catch {
    return [];
  }
}

/**
 * All generated analyses for this league, newest first, so reloading the page
 * doesn't cost another API call and older answers stay available.
 */
export async function loadAdviceHistory(leagueId: string, userId: string): Promise<SavedAdvice[]> {
  try {
    const items = await kv.lrange(key(leagueId, userId));
    if (items.length) return items.map((s) => JSON.parse(s) as SavedAdvice);
  } catch (e) {
    console.warn("[advice] could not load history:", e);
  }
  return loadLegacy(leagueId, userId);
}

export async function saveAdvice(leagueId: string, userId: string, advice: SavedAdvice) {
  try {
    const k = key(leagueId, userId);
    if (!(await kv.lrange(k)).length) {
      // First save into the new store: carry over the old file history (oldest first).
      for (const old of (await loadLegacy(leagueId, userId)).reverse()) {
        await kv.lpush(k, JSON.stringify(old), MAX_HISTORY);
      }
    }
    await kv.lpush(k, JSON.stringify(advice), MAX_HISTORY);
  } catch (e) {
    console.warn("[advice] could not persist analysis:", e);
  }
}
