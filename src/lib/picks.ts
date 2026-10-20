import type { TradedPick } from "./sleeper";

export interface DraftPick {
  id: string;
  season: string;
  round: number;
  originalRosterId: number;
  ownerRosterId: number;
  /** projected slot for the next draft, from the original owner's roster strength */
  tier: "early" | "mid" | "late" | null;
  value: number;
}

const MAX_FUTURE_SEASONS = 3;

/**
 * All future picks with owner and market value. Sleeper only records traded
 * picks; every other pick still belongs to its original team.
 */
export function buildPicks(opts: {
  season: string;
  draftDone: boolean;
  rounds: number;
  rosterIds: number[];
  traded: TradedPick[];
  pickValues: Record<string, number>;
  /** roster ids sorted weakest → strongest (weak teams pick early) */
  weakestFirst: number[];
}): DraftPick[] {
  const first = Number(opts.season) + (opts.draftDone ? 1 : 0);
  const years = [...new Set(Object.keys(opts.pickValues).map((k) => Number(k.split("-")[0])))]
    .filter((y) => y >= first)
    .sort()
    .slice(0, MAX_FUTURE_SEASONS);

  const owner = new Map<string, number>();
  for (const t of opts.traded) owner.set(`${t.season}-${t.round}-${t.roster_id}`, t.owner_id);

  const n = opts.weakestFirst.length || 1;
  const out: DraftPick[] = [];
  for (const year of years) {
    for (let round = 1; round <= opts.rounds; round++) {
      for (const rid of opts.rosterIds) {
        const pos = opts.weakestFirst.indexOf(rid);
        const tier = pos < 0 ? "mid" : pos < n / 3 ? "early" : pos < (2 * n) / 3 ? "mid" : "late";
        const tiered = opts.pickValues[`${year}-${round}-${tier}`];
        const value = tiered ?? opts.pickValues[`${year}-${round}`];
        if (value === undefined) continue; // no market for this round
        out.push({
          id: `pick:${year}:${round}:${rid}`,
          season: String(year),
          round,
          originalRosterId: rid,
          ownerRosterId: owner.get(`${year}-${round}-${rid}`) ?? rid,
          tier: tiered !== undefined ? tier : null,
          value,
        });
      }
    }
  }
  return out;
}

const ORD = ["", "1st", "2nd", "3rd", "4th", "5th", "6th"];
const TIER = { early: "früh", mid: "mittel", late: "spät" };

export function pickLabel(p: DraftPick, teamName: (rid: number) => string): string {
  const from = p.originalRosterId !== p.ownerRosterId ? ` von ${teamName(p.originalRosterId)}` : "";
  const tier = p.tier ? ` (${TIER[p.tier]})` : "";
  return `${p.season} ${ORD[p.round] ?? `R${p.round}`}${tier}${from}`;
}
