import { cached } from "./cache";
import { fetchJson } from "./http";

export interface Projection {
  playerId: string;
  team: string | null;
  opponent: string | null;
  /** fresher than the daily player dump */
  injuryStatus: string | null;
  stats: Record<string, number>;
}

export interface WeekProjections {
  byPlayer: Record<string, Projection>;
  /** NFL teams that play this week – any other team is on bye */
  teamsPlaying: string[];
}

interface RawProjection {
  player_id: string;
  team: string | null;
  opponent: string | null;
  stats: Record<string, number> | null;
  player?: { injury_status?: string | null } | null;
}

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
// Not stat lines – never multiply these with scoring settings.
// (Keep pts_allow_* buckets: DEF scoring depends on them.)
const NON_STAT = /^(adp_|pos_adp_|pts_(ppr|std|half_ppr)$|gp$|cmp_pct$)/;

export const getWeekProjections = (season: string, week: number) =>
  cached(`proj_${season}_${week}`, 30 * 60_000, async (): Promise<WeekProjections> => {
    const qs = POSITIONS.map((p) => `position[]=${p}`).join("&");
    const raw = await fetchJson<RawProjection[]>(
      `https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&${qs}`,
      { timeoutMs: 30000 },
    );
    const byPlayer: Record<string, Projection> = {};
    const teams = new Set<string>();
    for (const r of raw) {
      if (!r.stats) continue;
      const stats: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.stats)) {
        if (typeof v === "number" && !NON_STAT.test(k)) stats[k] = v;
      }
      byPlayer[r.player_id] = {
        playerId: r.player_id,
        team: r.team,
        opponent: r.opponent,
        injuryStatus: r.player?.injury_status ?? null,
        stats,
      };
      if (r.team) teams.add(r.team);
    }
    if (raw.length > 0 && Object.keys(byPlayer).length === 0) {
      throw new Error("Projection response had no usable stat lines");
    }
    return { byPlayer, teamsPlaying: [...teams] };
  }, { persist: true });

/** Fantasy points for a stat line under the league's own scoring settings. */
export function scoreStats(stats: Record<string, number>, scoring: Record<string, number>): number {
  let pts = 0;
  for (const [k, v] of Object.entries(stats)) {
    const mult = scoring[k];
    if (mult) pts += v * mult;
  }
  return Math.round(pts * 100) / 100;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// Typical game-to-game spread relative to the mean (coefficient of variation).
const THRESHOLD_STATS: Record<string, { mean: (s: Record<string, number>) => number; cv: number }> = {
  pass_yd: { mean: (s) => s.pass_yd ?? 0, cv: 0.3 },
  rush_yd: { mean: (s) => s.rush_yd ?? 0, cv: 0.55 },
  rec_yd: { mean: (s) => s.rec_yd ?? 0, cv: 0.65 },
  rush_rec_yd: { mean: (s) => (s.rush_yd ?? 0) + (s.rec_yd ?? 0), cv: 0.5 },
  pass_cmp: { mean: (s) => s.pass_cmp ?? 0, cv: 0.25 },
  rush_att: { mean: (s) => s.rush_att ?? 0, cv: 0.35 },
};
const PTS_ALLOW_SD = 10;
const YDS_ALLOW_SD = 65;

/**
 * Projections are single-game averages, so they can't trigger threshold
 * scoring (100-yard bonuses, DEF points-allowed tiers) the way real games do.
 * Replace those with their expected value under a normal approximation.
 */
export function expectedStats(
  stats: Record<string, number>,
  scoring: Record<string, number>,
): Record<string, number> {
  const out = { ...stats };
  for (const key of Object.keys(scoring)) {
    const bonus = /^bonus_(pass_yd|rush_yd|rec_yd|rush_rec_yd|pass_cmp|rush_att)_(\d+)$/.exec(key);
    if (bonus && out[key] === undefined) {
      const spec = THRESHOLD_STATS[bonus[1]];
      const mean = spec.mean(stats);
      if (mean > 0) out[key] = 1 - normCdf((Number(bonus[2]) - mean) / (spec.cv * mean));
    }
  }

  for (const kind of ["pts", "yds"] as const) {
    const mean = stats[`${kind}_allow`];
    if (mean === undefined) continue;
    const sd = kind === "pts" ? PTS_ALLOW_SD : YDS_ALLOW_SD;
    for (const key of Object.keys(out)) if (key.startsWith(`${kind}_allow_`)) delete out[key];
    for (const key of Object.keys(scoring)) {
      const b = new RegExp(`^${kind}_allow_(\\d+)(?:_(\\d+)|(p))?$`).exec(key);
      if (!b) continue;
      const lo = Number(b[1]);
      const hi = b[3] ? Infinity : b[2] !== undefined ? Number(b[2]) : lo; // "pts_allow_0" = exactly 0
      const loZ = lo === 0 ? -Infinity : (lo - 0.5 - mean) / sd;
      const hiZ = hi === Infinity ? Infinity : (hi + 0.5 - mean) / sd;
      out[key] = (hiZ === Infinity ? 1 : normCdf(hiZ)) - (loZ === -Infinity ? 0 : normCdf(loZ));
    }
  }
  return out;
}

/** Expected fantasy points of a projected stat line, including threshold scoring. */
export const scoreProjection = (stats: Record<string, number>, scoring: Record<string, number>) =>
  scoreStats(expectedStats(stats, scoring), scoring);

const OUT = new Set(["Out", "IR", "PUP", "Sus", "COV", "NA", "DNR"]);

export type Availability = "ok" | "questionable" | "doubtful" | "out" | "bye" | "no_projection";

export interface WeeklyOutlook {
  points: number;
  availability: Availability;
  opponent: string | null;
  /** game already started/finished – Sleeper won't let the player be moved */
  locked?: boolean;
}

/**
 * Projected points for this week, zeroed for players that won't play and
 * discounted for doubtful ones.
 */
export function weeklyOutlook(
  playerId: string,
  playerTeam: string | null,
  playerInjury: string | null,
  week: WeekProjections,
  teamsPlaying: Set<string>,
  scoring: Record<string, number>,
): WeeklyOutlook {
  const proj = week.byPlayer[playerId];
  const injury = proj?.injuryStatus ?? playerInjury;
  const team = proj?.team ?? playerTeam;
  if (team && teamsPlaying.size > 0 && !teamsPlaying.has(team)) {
    return { points: 0, availability: "bye", opponent: null };
  }
  if (injury && OUT.has(injury)) return { points: 0, availability: "out", opponent: proj?.opponent ?? null };
  if (!proj) return { points: 0, availability: "no_projection", opponent: null };
  const base = scoreProjection(proj.stats, scoring);
  if (injury === "Doubtful") {
    return { points: Math.round(base * 0.25 * 100) / 100, availability: "doubtful", opponent: proj.opponent };
  }
  return {
    points: base,
    availability: injury === "Questionable" ? "questionable" : "ok",
    opponent: proj.opponent,
  };
}
