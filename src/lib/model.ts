import { optimalLineup, type LineupCandidate, type LineupResult } from "./lineup";
import type { WeeklyOutlook } from "./projections";

export interface PlayerInfo {
  id: string;
  name: string;
  position: string;
  positions: string[];
  team: string | null;
  age: number | null;
  injury: string | null;
  /** market value adjusted to league scoring (0 if not traded, e.g. K/DEF/deep bench) */
  value: number;
  /** unadjusted FantasyCalc value */
  rawValue: number;
  /** league-scoring adjustment applied to rawValue (1 = none) */
  scoringFactor: number;
  trend30: number;
  /** null when no weekly projections are available (offseason, outage) */
  week: WeeklyOutlook | null;
  trendingAdds: number;
}

export interface Team {
  rosterId: number;
  name: string;
  manager: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** all rostered players incl. IR and taxi */
  players: string[];
  reserve: string[];
  taxi: string[];
  /** Sleeper's currently set starters, aligned with starting slots ("0" = empty) */
  starters: string[];
  /** owned future draft picks (ids into LeagueModel.players, position "PICK") */
  picks: string[];
}

export interface LeagueModel {
  leagueId: string;
  leagueName: string;
  season: string;
  week: number | null;
  isDynasty: boolean;
  slots: string[];
  players: Record<string, PlayerInfo>;
  teams: Team[];
  me: Team;
  freeAgents: string[];
}

/** Everything a team can trade: players and draft picks. */
export const assets = (t: Team) => [...t.players, ...t.picks];

export const isPick = (p: PlayerInfo | undefined) => p?.position === "PICK";

/** Players that may be placed into the weekly lineup (not on IR / taxi). */
export const activePlayers = (t: Team) => {
  const inactive = new Set([...t.reserve, ...t.taxi]);
  return t.players.filter((id) => !inactive.has(id));
};

function candidates(
  ids: string[],
  m: LeagueModel,
  score: (p: PlayerInfo) => number,
): LineupCandidate[] {
  return ids
    .map((id) => m.players[id])
    .filter((p): p is PlayerInfo => !!p)
    .map((p) => ({ id: p.id, positions: p.positions, score: score(p) }));
}

/** Best lineup for *this week* by projected points. */
export const weeklyLineup = (ids: string[], m: LeagueModel, slots = m.slots): LineupResult =>
  optimalLineup(
    slots,
    // tiny value tie-break so 0-point players are ordered sensibly
    candidates(ids, m, (p) => (p.week?.points ?? 0) + p.value * 1e-6),
  );

/** Best lineup by market value – a proxy for rest-of-season strength. */
export const valueLineup = (ids: string[], m: LeagueModel): LineupResult => {
  // K/DEF have no market value – break ties by this week's projection.
  const lu = optimalLineup(m.slots, candidates(ids, m, (p) => p.value + (p.week?.points ?? 0) * 1e-3));
  const slots = lu.slots.map((s) => ({ ...s, score: s.playerId ? m.players[s.playerId].value : 0 }));
  return { slots, total: slots.reduce((sum, s) => sum + s.score, 0) };
};

const BENCH_DEPTH = 4;
const BENCH_WEIGHT = 0.2;
/** Picks don't score this season, but they're currency for future trades. */
const PICK_WEIGHT = 0.15;

/**
 * Roster strength = value of the best possible starting lineup plus a small
 * credit for the top bench players (injuries, byes). Adding a 30th bench body
 * adds nothing, which is exactly what makes 2-for-1 trades evaluable.
 */
export function strength(ids: string[], m: LeagueModel): number {
  const players = ids.filter((id) => !isPick(m.players[id]));
  const picks = ids.filter((id) => isPick(m.players[id]));
  const lu = valueLineup(players, m);
  const starters = new Set(lu.slots.map((s) => s.playerId));
  const bench = players
    .filter((id) => !starters.has(id))
    .map((id) => m.players[id]?.value ?? 0)
    .sort((a, b) => b - a)
    .slice(0, BENCH_DEPTH);
  const pickValue = picks.reduce((s, id) => s + m.players[id].value, 0);
  return lu.total + BENCH_WEIGHT * bench.reduce((s, v) => s + v, 0) + PICK_WEIGHT * pickValue;
}

/** Starter value per primary position for the value-optimal lineup. */
export function starterValueByPosition(ids: string[], m: LeagueModel): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of valueLineup(ids, m).slots) {
    if (!s.playerId) continue;
    const pos = m.players[s.playerId].position;
    out[pos] = (out[pos] ?? 0) + s.score;
  }
  return out;
}
