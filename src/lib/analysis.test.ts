import { describe, expect, it } from "vitest";
import { lineupAdvice } from "./analysis";
import type { LeagueModel, PlayerInfo, Team } from "./model";

const p = (id: string, position: string, points: number, locked = false): PlayerInfo => ({
  id, name: id, position, positions: [position], team: "KC", age: 25, injury: null, value: 0, rawValue: 0, scoringFactor: 1,
  trend30: 0, trendingAdds: 0, week: { points, availability: "ok", opponent: "BUF", locked },
});

function model(players: PlayerInfo[], starters: string[]): LeagueModel {
  const me: Team = {
    rosterId: 1, name: "me", manager: "", wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
    players: players.map((x) => x.id), reserve: [], taxi: [], starters, picks: [],
  };
  return {
    leagueId: "x", leagueName: "x", season: "2026", week: 3, isDynasty: false, slots: ["WR", "FLEX"],
    players: Object.fromEntries(players.map((x) => [x.id, x])), teams: [me], me, freeAgents: [],
  };
}

describe("lineupAdvice", () => {
  it("suggests the better player when nothing is locked", () => {
    const a = lineupAdvice(model([p("a", "WR", 5), p("b", "WR", 10), p("c", "WR", 12)], ["a", "b"]));
    expect(a.moves.map((mv) => [mv.start, mv.bench])).toEqual([["c", "a"]]);
  });

  it("never moves a locked starter out", () => {
    const a = lineupAdvice(model([p("a", "WR", 5, true), p("b", "WR", 10), p("c", "WR", 12)], ["a", "b"]));
    expect(a.optimal[0]).toMatchObject({ playerId: "a", locked: true });
    expect(a.moves.map((mv) => [mv.start, mv.bench])).toEqual([["c", "b"]]);
  });

  it("never moves a locked bench player in", () => {
    const a = lineupAdvice(model([p("a", "WR", 5), p("b", "WR", 10), p("c", "WR", 12, true)], ["a", "b"]));
    expect(a.moves).toEqual([]);
  });
});
