import { activePlayers, strength, valueLineup, weeklyLineup, type LeagueModel } from "./model";

export interface WaiverIdea {
  add: string;
  drop: string | null;
  /** rest-of-season roster strength gain */
  rosGain: number;
  /** projected points gain for this week's optimal lineup */
  weekGain: number;
  /** market value of the added player minus the dropped one */
  valueGain: number;
  /** clearly more valuable than the drop, even if not a starter yet */
  betterStash: boolean;
}

const STREAM_POSITIONS = new Set(["K", "DEF"]);

export function findWaivers(
  m: LeagueModel,
  limit = 12,
): { restOfSeason: WaiverIdea[]; thisWeek: WaiverIdea[] } {
  const me = m.me;
  const val = (id: string) => m.players[id]?.value ?? 0;
  const pts = (id: string) => m.players[id]?.week?.points ?? 0;
  // Once a game has started, Sleeper blocks dropping that player, and an add can no longer play this week.
  const locked = (id: string) => !!m.players[id]?.week?.locked;

  const myBase = strength(me.players, m);
  const myWeek = m.week === null ? 0 : weeklyLineup(activePlayers(me), m).total;

  // Drop candidates: bench players (not in value- or weekly-optimal lineup), cheapest first.
  const starters = new Set(
    [...valueLineup(me.players, m).slots, ...(m.week === null ? [] : weeklyLineup(activePlayers(me), m).slots)]
      .map((s) => s.playerId)
      .filter(Boolean),
  );
  const bench = activePlayers(me)
    .filter((id) => !starters.has(id) && !locked(id))
    .sort((a, b) => val(a) - val(b) || pts(a) - pts(b));

  // Only look at free agents that could plausibly matter.
  const pool = m.freeAgents
    .filter((id) => val(id) > 0 || pts(id) > 0 || m.players[id].trendingAdds > 0)
    .sort((a, b) => val(b) - val(a) || pts(b) - pts(a))
    .slice(0, 150);

  const ideas: WaiverIdea[] = [];
  for (const add of pool) {
    const pos = m.players[add].position;
    // Streaming K/DEF swaps like for like; everything else drops the weakest bench player.
    const samePos = me.players.filter((id) => m.players[id]?.position === pos && !locked(id));
    const drop = STREAM_POSITIONS.has(pos) && samePos.length > 0
      ? samePos.sort((a, b) => pts(a) - pts(b))[0]
      : (bench[0] ?? null);

    const after = me.players.filter((id) => id !== drop).concat(add);
    const rosGain = strength(after, m) - myBase;
    const weekGain =
      m.week === null || locked(add)
        ? 0
        : weeklyLineup(activePlayers({ ...me, players: after }), m).total - myWeek;
    const valueGain = val(add) - (drop ? val(drop) : 0);
    // A clearly more valuable bench piece is worth grabbing even if it doesn't start yet.
    const betterStash = drop !== null && valueGain > Math.max(150, 0.25 * val(drop));
    if (rosGain > 0.002 * myBase || weekGain >= 1 || betterStash) {
      ideas.push({ add, drop, rosGain, weekGain, valueGain, betterStash });
    }
  }

  return {
    restOfSeason: ideas
      .filter((i) => i.rosGain > 0.002 * myBase || i.betterStash)
      .sort((a, b) => b.rosGain - a.rosGain || b.valueGain - a.valueGain)
      .slice(0, limit),
    thisWeek: ideas
      .filter((i) => i.weekGain >= 1)
      .sort((a, b) => b.weekGain - a.weekGain)
      .slice(0, limit),
  };
}
