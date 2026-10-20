/** Which player positions may fill each Sleeper roster slot. */
export const SLOT_ELIGIBILITY: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  DL: ["DL", "DE", "DT"],
  LB: ["LB"],
  DB: ["DB", "CB", "S"],
  IDP_FLEX: ["DL", "DE", "DT", "LB", "DB", "CB", "S"],
};

export const NON_STARTING_SLOTS = new Set(["BN", "IR", "TAXI"]);

export const startingSlots = (rosterPositions: string[]) =>
  rosterPositions.filter((s) => !NON_STARTING_SLOTS.has(s));

export interface LineupCandidate {
  id: string;
  positions: string[];
  score: number;
}

export interface LineupResult {
  /** player id per slot, null when no eligible player is available */
  slots: { slot: string; playerId: string | null; score: number }[];
  total: number;
}

export const canFill = (slot: string, positions: string[]) =>
  (SLOT_ELIGIBILITY[slot] ?? [slot]).some((p) => positions.includes(p));

/**
 * Hungarian algorithm (min-cost assignment) for an n×m matrix with n ≤ m.
 * Returns for each row the assigned column.
 */
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const m = cost[0]?.length ?? 0;
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const rowToCol = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j] > 0) rowToCol[p[j] - 1] = j - 1;
  return rowToCol;
}

/** Exact best lineup: maximises the summed score over all starting slots. */
export function optimalLineup(slots: string[], candidates: LineupCandidate[]): LineupResult {
  if (slots.length === 0) return { slots: [], total: 0 };
  // One dummy "empty" column per slot so every slot can stay unfilled.
  const cols = candidates.length + slots.length;
  const BIG = 1e9;
  const cost = slots.map((slot) => {
    const row = new Array(cols).fill(0);
    candidates.forEach((c, j) => {
      row[j] = canFill(slot, c.positions) ? -c.score : BIG;
    });
    return row;
  });
  const assign = hungarian(cost);
  const result = slots.map((slot, i) => {
    const j = assign[i];
    const c = j >= 0 && j < candidates.length && cost[i][j] < BIG ? candidates[j] : null;
    return { slot, playerId: c?.id ?? null, score: c?.score ?? 0 };
  });
  return { slots: result, total: result.reduce((s, r) => s + r.score, 0) };
}
