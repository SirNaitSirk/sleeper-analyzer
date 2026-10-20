import { cached } from "./cache";
import { fetchJson } from "./http";
import { scoreProjection } from "./projections";

interface RawSeasonProjection {
  player_id: string;
  stats: Record<string, number> | null;
}

/** Full-season projections, converted to per-game stat lines. */
export const getSeasonProjections = (season: string) =>
  cached(
    `sproj_${season}`,
    12 * 60 * 60_000,
    async () => {
      const qs = ["QB", "RB", "WR", "TE"].map((p) => `position[]=${p}`).join("&");
      const raw = await fetchJson<RawSeasonProjection[]>(
        `https://api.sleeper.app/projections/nfl/${season}?season_type=regular&${qs}`,
        { timeoutMs: 30000 },
      );
      const out: Record<string, Record<string, number>> = {};
      for (const r of raw) {
        const gp = r.stats?.gp;
        if (!r.stats || !gp) continue;
        const perGame: Record<string, number> = {};
        for (const [k, v] of Object.entries(r.stats)) {
          if (typeof v === "number" && !/^(adp_|pos_adp_|pts_(ppr|std|half_ppr)$|gp$|cmp_pct$)/.test(k)) {
            perGame[k] = v / gp;
          }
        }
        out[r.player_id] = perGame;
      }
      if (Object.keys(out).length < 100) throw new Error("Season projections returned too few players");
      return out;
    },
    { persist: true },
  );

/** The scoring FantasyCalc's values are based on: standard Sleeper settings with the given PPR. */
export const referenceScoring = (ppr: number): Record<string, number> => ({
  pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec: ppr, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fum_lost: -2,
});

// Market value rises faster than points (scarcity), hence the exponent.
const EXPONENT = 1.5;
const CLAMP: [number, number] = [0.6, 1.6];
const MIN_POINTS_PER_GAME = 5;

/**
 * How much more (or less) valuable each player is under the league's scoring
 * than under FantasyCalc's reference scoring – e.g. TEs in TE-premium leagues,
 * QBs with 6-point passing TDs. Factors are normalised to the median player,
 * so uniform differences (everyone scores more) don't change anything.
 */
export function scoringFactors(
  perGame: Record<string, Record<string, number>>,
  leagueScoring: Record<string, number>,
  ppr: number,
): Record<string, number> {
  const ref = referenceScoring(ppr);
  const ratios: [string, number][] = [];
  for (const [id, stats] of Object.entries(perGame)) {
    const base = scoreProjection(stats, ref);
    if (base < MIN_POINTS_PER_GAME) continue;
    ratios.push([id, scoreProjection(stats, leagueScoring) / base]);
  }
  if (ratios.length === 0) return {};
  const sorted = ratios.map(([, r]) => r).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return {};

  const out: Record<string, number> = {};
  for (const [id, r] of ratios) {
    const f = Math.pow(r / median, EXPONENT);
    out[id] = Math.min(CLAMP[1], Math.max(CLAMP[0], f));
  }
  return out;
}
