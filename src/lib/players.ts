import { cached } from "./cache";
import { fetchJson } from "./http";

export interface Player {
  id: string;
  name: string;
  position: string;
  fantasyPositions: string[];
  team: string | null;
  age: number | null;
  injuryStatus: string | null;
  depthChartOrder: number | null;
}

interface RawPlayer {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  age?: number | null;
  injury_status?: string | null;
  depth_chart_order?: number | null;
}

/**
 * The full player dump is ~14 MB; Sleeper asks to fetch it at most once per
 * day. We slim it down and persist it to disk.
 */
export const getPlayers = () =>
  cached(
    "players_nfl",
    24 * 60 * 60_000,
    async () => {
      const raw = await fetchJson<Record<string, RawPlayer>>(
        "https://api.sleeper.app/v1/players/nfl",
        { timeoutMs: 60000 },
      );
      const out: Record<string, Player> = {};
      for (const [id, p] of Object.entries(raw)) {
        const position = p.position ?? p.fantasy_positions?.[0];
        if (!position) continue;
        out[id] = {
          id,
          name:
            p.full_name ??
            (`${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || id),
          position,
          fantasyPositions: p.fantasy_positions?.length ? p.fantasy_positions : [position],
          team: p.team ?? null,
          age: p.age ?? null,
          injuryStatus: p.injury_status ?? null,
          depthChartOrder: p.depth_chart_order ?? null,
        };
      }
      return out;
    },
    { persist: true },
  );
