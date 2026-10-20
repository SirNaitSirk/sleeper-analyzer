import { cached } from "./cache";
import { fetchJson } from "./http";
import type { League } from "./sleeper";

export interface ValueParams {
  isDynasty: boolean;
  numQbs: 1 | 2;
  numTeams: number;
  ppr: 0 | 0.5 | 1;
}

interface RawValue {
  player: { sleeperId: string | null; position: string; name: string };
  value: number;
  redraftValue?: number;
  trend30Day?: number;
}

export interface MarketValue {
  value: number;
  trend30Day: number;
}

export interface MarketValues {
  players: Record<string, MarketValue>;
  /** dynasty only, keyed "2027-1" (generic) or "2027-1-early" / "-mid" / "-late" */
  picks: Record<string, number>;
}

const PICK_NAME = /^(\d{4}) (\d)(?:st|nd|rd|th)(?: \((Early|Mid|Late)\))?$/;

/** Derive the FantasyCalc market that best matches the league's format. */
export function valueParamsFor(league: League): ValueParams {
  const superflex = league.roster_positions.includes("SUPER_FLEX");
  const qbSlots = league.roster_positions.filter((p) => p === "QB").length;
  const rec = league.scoring_settings.rec ?? 0;
  const numTeams = Math.min(16, Math.max(8, league.total_rosters || 12));
  return {
    isDynasty: league.settings.type === 2,
    numQbs: superflex || qbSlots >= 2 ? 2 : 1,
    numTeams,
    ppr: rec >= 0.75 ? 1 : rec >= 0.25 ? 0.5 : 0,
  };
}

/**
 * Crowd-sourced trade values from FantasyCalc (built from real trades).
 * Dynasty values include long-term outlook; redraft values are rest-of-season.
 */
export const getMarketValues = (p: ValueParams) =>
  cached(
    `fc_v2_${p.isDynasty ? "dyn" : "red"}_${p.numQbs}qb_${p.numTeams}t_${p.ppr}ppr`,
    6 * 60 * 60_000,
    async (): Promise<MarketValues> => {
      const raw = await fetchJson<RawValue[]>(
        `https://api.fantasycalc.com/values/current?isDynasty=${p.isDynasty}&numQbs=${p.numQbs}&numTeams=${p.numTeams}&ppr=${p.ppr}`,
      );
      const players: Record<string, MarketValue> = {};
      const picks: Record<string, number> = {};
      for (const r of raw) {
        if (r.player.position === "PICK") {
          const m = PICK_NAME.exec(r.player.name);
          if (m) picks[[m[1], m[2], m[3]?.toLowerCase()].filter(Boolean).join("-")] = r.value;
          continue;
        }
        if (!r.player.sleeperId) continue;
        players[r.player.sleeperId] = { value: r.value, trend30Day: r.trend30Day ?? 0 };
      }
      if (Object.keys(players).length < 100) throw new Error("FantasyCalc returned too few values");
      return { players, picks };
    },
    { persist: true },
  );
