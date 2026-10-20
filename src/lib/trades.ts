import { assets, strength, type LeagueModel, type Team } from "./model";

export interface TradeIdea {
  partner: Team;
  give: string[];
  get: string[];
  /** change in my roster strength */
  myGain: number;
  myGainPct: number;
  theirGain: number;
  theirGainPct: number;
  /** adjusted value I give / adjusted value I get (1 = even, >1 = I overpay) */
  valueRatio: number;
}

/**
 * Stars are worth more than the sum of their parts (roster spots are
 * limited), so package values are compared on a convex scale – the same idea
 * as the "value adjustment" in KTC/FantasyCalc trade calculators.
 */
const CONVEXITY = 1.3;
export const packageValue = (values: number[]) =>
  Math.pow(values.reduce((s, v) => s + Math.pow(Math.max(v, 0), CONVEXITY), 0), 1 / CONVEXITY);

export interface TradeOptions {
  /** players per roster considered as trade pieces */
  pieces?: number;
  minValue?: number;
  /** partner must receive ≥ this share of what they give */
  minPartnerRatio?: number;
  /** I pay at most this multiple of what I receive */
  maxOverpay?: number;
  /** partner strength may drop by at most this share */
  maxPartnerLoss?: number;
  /** my strength must improve by at least this share */
  minMyGain?: number;
}

const DEFAULTS: Required<TradeOptions> = {
  pieces: 16,
  minValue: 300,
  minPartnerRatio: 0.97,
  maxOverpay: 1.2,
  maxPartnerLoss: 0.01,
  minMyGain: 0.005,
};

function combos(ids: string[]): string[][] {
  const out: string[][] = ids.map((id) => [id]);
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
  return out;
}

export function findTrades(m: LeagueModel, opts: TradeOptions = {}): TradeIdea[] {
  const o = { ...DEFAULTS, ...opts };
  const val = (id: string) => m.players[id]?.value ?? 0;
  const pieces = (t: Team) =>
    assets(t)
      .filter((id) => val(id) >= o.minValue)
      .sort((a, b) => val(b) - val(a))
      .slice(0, o.pieces);

  const me = m.me;
  const myAssets = assets(me);
  const myBase = strength(myAssets, m);
  const myPackages = combos(pieces(me));
  const ideas: TradeIdea[] = [];

  for (const partner of m.teams) {
    if (partner.rosterId === me.rosterId) continue;
    const theirAssets = assets(partner);
    const theirBase = strength(theirAssets, m);
    const theirPackages = combos(pieces(partner));

    for (const give of myPackages) {
      const giveV = packageValue(give.map(val));
      for (const get of theirPackages) {
        if (give.length === 2 && get.length === 2) continue; // 2-for-2 rarely adds signal, 4× the cost
        const getV = packageValue(get.map(val));
        const ratio = giveV / getV;
        // Cheap value filter first – lineup evaluation is the expensive part.
        if (ratio < o.minPartnerRatio || ratio > o.maxOverpay) continue;

        const myAfter = myAssets.filter((id) => !give.includes(id)).concat(get);
        const myGain = strength(myAfter, m) - myBase;
        if (myGain < o.minMyGain * myBase) continue;

        const theirAfter = theirAssets.filter((id) => !get.includes(id)).concat(give);
        const theirGain = strength(theirAfter, m) - theirBase;
        if (theirGain < -o.maxPartnerLoss * theirBase) continue;

        ideas.push({
          partner,
          give,
          get,
          myGain,
          myGainPct: myGain / myBase,
          theirGain,
          theirGainPct: theirBase > 0 ? theirGain / theirBase : 0,
          valueRatio: ratio,
        });
      }
    }
  }

  // Prefer trades that help me most while also helping the partner (more likely accepted).
  const score = (t: TradeIdea) => t.myGainPct + 0.5 * Math.max(t.theirGainPct, -0.01) - 0.05 * Math.max(0, t.valueRatio - 1);
  ideas.sort((a, b) => score(b) - score(a));

  // Keep variety: best idea per target package, max 3 per partner.
  const seenGet = new Set<string>();
  const perPartner = new Map<number, number>();
  return ideas.filter((t) => {
    const key = [...t.get].sort().join(",");
    const n = perPartner.get(t.partner.rosterId) ?? 0;
    if (seenGet.has(key) || n >= 3) return false;
    seenGet.add(key);
    perPartner.set(t.partner.rosterId, n + 1);
    return true;
  });
}

export interface TradeEvaluation {
  giveValue: number;
  getValue: number;
  valueRatio: number;
  myGain: number;
  myGainPct: number;
  partners: { team: Team; gain: number; gainPct: number }[];
}

/** Evaluate an arbitrary trade; `get` may include players from several teams. */
export function evaluateTrade(m: LeagueModel, give: string[], get: string[]): TradeEvaluation {
  const val = (id: string) => m.players[id]?.value ?? 0;
  const giveValue = packageValue(give.map(val));
  const getValue = packageValue(get.map(val));
  const myAssets = assets(m.me);
  const myBase = strength(myAssets, m);
  const myAfter = myAssets.filter((id) => !give.includes(id)).concat(get);
  const myGain = strength(myAfter, m) - myBase;

  // With several partners it's unknown who receives which of my players, so
  // only a single partner is credited with the give side.
  const partnerTeams = m.teams.filter(
    (t) => t.rosterId !== m.me.rosterId && assets(t).some((id) => get.includes(id)),
  );
  const partners = partnerTeams.map((team) => {
    const base = strength(assets(team), m);
    const after = assets(team)
      .filter((id) => !get.includes(id))
      .concat(partnerTeams.length === 1 ? give : []);
    const gain = strength(after, m) - base;
    return { team, gain, gainPct: base > 0 ? gain / base : 0 };
  });

  return {
    giveValue,
    getValue,
    valueRatio: getValue > 0 ? giveValue / getValue : Infinity,
    myGain,
    myGainPct: myBase > 0 ? myGain / myBase : 0,
    partners,
  };
}
