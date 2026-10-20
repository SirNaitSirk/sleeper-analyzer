import { cached } from "./cache";
import { fetchJson } from "./http";

export interface Game {
  week: number;
  date: string;
  home: string;
  away: string;
  status: string; // "pre_game" | "in_game" | "complete"
}

export const getSchedule = (season: string) =>
  cached(`schedule_${season}`, 2 * 60_000, () =>
    fetchJson<Game[]>(`https://api.sleeper.app/schedule/nfl/regular/${season}`),
  );

/**
 * NFL teams whose game this week has kicked off or finished. Sleeper locks
 * those players: they can't be moved into/out of the lineup or dropped.
 */
export function lockedTeams(games: Game[], week: number, now = new Date()): Set<string> {
  // Fallback if the status lags behind: a game dated before today (US time) has certainly started.
  const todayUs = new Date(now.getTime() - 5 * 3600_000).toISOString().slice(0, 10);
  const locked = new Set<string>();
  for (const g of games) {
    if (g.week !== week) continue;
    if (g.status !== "pre_game" || g.date < todayUs) {
      locked.add(g.home);
      locked.add(g.away);
    }
  }
  return locked;
}
