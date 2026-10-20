import {
  activePlayers,
  assets,
  starterValueByPosition,
  strength,
  valueLineup,
  weeklyLineup,
  type LeagueModel,
  type Team,
} from "./model";

export interface LineupAdvice {
  optimal: { slot: string; playerId: string | null; points: number; locked: boolean }[];
  optimalTotal: number;
  currentTotal: number;
  moves: { start: string; bench: string | null; gain: number }[];
  warnings: { playerId: string | null; slot: string; reason: string }[];
  /** number of starting slots fixed because the game already started */
  lockedSlots: number;
}

const REASON: Record<string, string> = {
  bye: "hat Bye-Week",
  out: "fällt aus (Out/IR)",
  doubtful: "ist Doubtful",
  questionable: "ist Questionable",
  no_projection: "hat keine Projektion",
};

export function lineupAdvice(m: LeagueModel, team: Team = m.me): LineupAdvice {
  const pts = (id: string | null) => (id ? m.players[id]?.week?.points ?? 0 : 0);
  const isLocked = (id: string) => !!m.players[id]?.week?.locked;

  // Starters whose game has kicked off stay where they are; locked bench players can't come in.
  const fixed = m.slots.map((_, i) => {
    const id = team.starters[i];
    return id && id !== "0" && isLocked(id) ? id : null;
  });
  const openIdx = m.slots.map((_, i) => i).filter((i) => !fixed[i]);
  const pool = activePlayers(team).filter((id) => !isLocked(id));
  const sub = weeklyLineup(pool, m, openIdx.map((i) => m.slots[i]));
  const subById = new Map(openIdx.map((slotIdx, k) => [slotIdx, sub.slots[k].playerId]));

  const optimal = m.slots.map((slot, i) => {
    const playerId = fixed[i] ?? subById.get(i) ?? null;
    return { slot, playerId, points: pts(playerId), locked: !!fixed[i] };
  });
  const optimalTotal = optimal.reduce((s, r) => s + r.points, 0);
  const current = team.starters.filter((id) => id && id !== "0");
  const currentTotal = current.reduce((s, id) => s + pts(id), 0);

  const optIds = new Set(optimal.map((o) => o.playerId).filter(Boolean) as string[]);
  const curIds = new Set(current);
  const toStart = [...optIds].filter((id) => !curIds.has(id)).sort((a, b) => pts(b) - pts(a));
  const toBench = [...curIds].filter((id) => !optIds.has(id)).sort((a, b) => pts(a) - pts(b));
  const moves = toStart.map((id, i) => ({
    start: id,
    bench: toBench[i] ?? null,
    gain: pts(id) - pts(toBench[i] ?? null),
  }));

  const warnings: LineupAdvice["warnings"] = [];
  team.starters.forEach((id, i) => {
    const slot = m.slots[i] ?? "?";
    if (!id || id === "0") {
      warnings.push({ playerId: null, slot, reason: "Slot ist leer" });
      return;
    }
    const a = m.players[id]?.week?.availability;
    // For locked players the outcome is already decided – no point warning.
    if (a && a !== "ok" && !isLocked(id)) warnings.push({ playerId: id, slot, reason: REASON[a] ?? a });
  });

  return { optimal, optimalTotal, currentTotal, moves, warnings, lockedSlots: fixed.filter(Boolean).length };
}

export interface PositionNeed {
  position: string;
  mine: number;
  leagueAvg: number;
  /** mine relative to league average, e.g. -0.3 = 30 % below */
  delta: number;
  rank: number;
}

/** Positional starter strength vs. the league. */
export function positionalNeeds(m: LeagueModel, team: Team = m.me): PositionNeed[] {
  const byTeam = new Map(m.teams.map((t) => [t.rosterId, starterValueByPosition(t.players, m)]));
  const positions = [...new Set([...byTeam.values()].flatMap((r) => Object.keys(r)))].filter(
    (pos) => [...byTeam.values()].some((r) => (r[pos] ?? 0) > 0),
  );
  const mine = byTeam.get(team.rosterId)!;
  return positions
    .map((position) => {
      const all = m.teams.map((t) => byTeam.get(t.rosterId)![position] ?? 0);
      const leagueAvg = all.reduce((s, v) => s + v, 0) / all.length;
      const my = mine[position] ?? 0;
      return {
        position,
        mine: my,
        leagueAvg,
        delta: leagueAvg > 0 ? my / leagueAvg - 1 : 0,
        rank: all.filter((v) => v > my).length + 1,
      };
    })
    .sort((a, b) => a.delta - b.delta);
}

export interface PowerRow {
  team: Team;
  strength: number;
  starterValue: number;
  totalValue: number;
  weekProjection: number | null;
}

export function powerRankings(m: LeagueModel): PowerRow[] {
  return m.teams
    .map((team) => ({
      team,
      strength: strength(assets(team), m),
      starterValue: valueLineup(team.players, m).total,
      totalValue: assets(team).reduce((s, id) => s + (m.players[id]?.value ?? 0), 0),
      weekProjection: m.week === null ? null : weeklyLineup(activePlayers(team), m).total,
    }))
    .sort((a, b) => b.strength - a.strength);
}
