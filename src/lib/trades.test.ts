import { describe, expect, it } from "vitest";
import type { LeagueModel, PlayerInfo, Team } from "./model";
import { evaluateTrade, findTrades, packageValue } from "./trades";

const p = (id: string, position: string, value: number): PlayerInfo => ({
  id, name: id, position, positions: [position], team: "KC", age: 25, injury: null,
  value, rawValue: value, scoringFactor: 1, trend30: 0, week: null, trendingAdds: 0,
});
const team = (rosterId: number, players: string[]): Team => ({
  rosterId, name: `T${rosterId}`, manager: "", wins: 0, losses: 0, ties: 0,
  pointsFor: 0, pointsAgainst: 0, players, reserve: [], taxi: [], starters: [], picks: [],
});

function model(): LeagueModel {
  const players = [
    // me: deep at WR, weak at RB
    p("w1", "WR", 6000), p("w2", "WR", 5000), p("w3", "WR", 4500), p("r1", "RB", 1000), p("r2", "RB", 800),
    // them: deep at RB, weak at WR
    p("R1", "RB", 6000), p("R2", "RB", 5000), p("R3", "RB", 4500), p("W1", "WR", 1000), p("W2", "WR", 800),
  ];
  const me = team(1, ["w1", "w2", "w3", "r1", "r2"]);
  return {
    leagueId: "x", leagueName: "x", season: "2026", week: null, isDynasty: false,
    slots: ["RB", "WR", "FLEX"],
    players: Object.fromEntries(players.map((x) => [x.id, x])),
    teams: [me, team(2, ["R1", "R2", "R3", "W1", "W2"])],
    me, freeAgents: [],
  };
}

describe("packageValue", () => {
  it("values one star above two halves", () => {
    expect(packageValue([10000])).toBeGreaterThan(packageValue([5000, 5000]));
  });
});

describe("findTrades", () => {
  it("finds the complementary surplus-for-need swap that helps both sides", () => {
    const ideas = findTrades(model(), { minValue: 0 });
    expect(ideas.length).toBeGreaterThan(0);
    const best = ideas[0];
    // I send WR surplus and receive their RB surplus.
    expect(best.give.some((id) => id.startsWith("w"))).toBe(true);
    expect(best.get.every((id) => id.startsWith("R"))).toBe(true);
    expect(best.myGain).toBeGreaterThan(0);
    expect(best.theirGain).toBeGreaterThanOrEqual(0);
  });

  it("never proposes trades the partner would clearly reject", () => {
    for (const t of findTrades(model(), { minValue: 0 })) expect(t.valueRatio).toBeGreaterThanOrEqual(0.97);
  });
});

describe("evaluateTrade", () => {
  it("reports gains for both teams", () => {
    const e = evaluateTrade(model(), ["w3"], ["R3"]);
    expect(e.valueRatio).toBeCloseTo(1);
    expect(e.myGain).toBeGreaterThan(0);
    expect(e.partners[0].gain).toBeGreaterThan(0);
  });
});

describe("picks in trades", () => {
  it("considers draft picks as trade pieces", () => {
    const players = [
      p("w1", "WR", 6000), p("r1", "RB", 1000), // me: weak RB
      p("R1", "RB", 6000), p("R3", "RB", 4500), p("W1", "WR", 1000), // them: RB depth
      { ...p("pk", "PICK", 4500), positions: ["PICK"], team: null },
    ];
    const me = { ...team(1, ["w1", "r1"]), picks: ["pk"] };
    const m: LeagueModel = {
      leagueId: "x", leagueName: "x", season: "2026", week: null, isDynasty: true, slots: ["RB", "WR"],
      players: Object.fromEntries(players.map((x) => [x.id, x])),
      teams: [me, team(2, ["R1", "R3", "W1"])], me, freeAgents: [],
    };
    // Partner trades a bench RB (20 % weight) for a pick (15 % weight) – a small loss for them.
    const ideas = findTrades(m, { minValue: 0, maxPartnerLoss: 0.05 });
    expect(ideas[0]).toMatchObject({ give: ["pk"], get: ["R3"] });
  });
});
