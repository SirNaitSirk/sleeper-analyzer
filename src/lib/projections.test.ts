import { describe, expect, it } from "vitest";
import { expectedStats, scoreProjection, scoreStats, weeklyOutlook, type WeekProjections } from "./projections";

const halfPpr = {
  pass_yd: 0.04, pass_td: 4, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec: 0.5,
  rec_yd: 0.1, rec_td: 6, fum_lost: -2, pass_2pt: 2, rush_2pt: 2, rec_2pt: 2,
};

// Real Sleeper/Rotowire stat line whose pts_half_ppr is 9.18.
const wr = {
  rec: 3.99, rec_yd: 52.46, rec_td: 0.3, rush_yd: 0.99, rush_td: 0.01, fum_lost: 0.02,
  rec_2pt: 0.01, rec_tgt: 7.17, bonus_rec_wr: 3.99,
};

describe("scoreStats", () => {
  it("matches Sleeper's own half-PPR projection", () => {
    expect(scoreStats(wr, halfPpr)).toBeCloseTo(9.18, 1);
  });
  it("applies league-specific bonuses", () => {
    expect(scoreStats(wr, { ...halfPpr, bonus_rec_wr: 0.5 })).toBeCloseTo(9.18 + 2, 1);
  });
});

describe("weeklyOutlook", () => {
  const week: WeekProjections = {
    byPlayer: { a: { playerId: "a", team: "KC", opponent: "BUF", injuryStatus: null, stats: { rec: 10 } } },
    teamsPlaying: ["KC", "BUF"],
  };
  const playing = new Set(week.teamsPlaying);
  it("zeroes players on bye", () => {
    expect(weeklyOutlook("b", "DAL", null, week, playing, { rec: 1 }).availability).toBe("bye");
  });
  it("zeroes injured players", () => {
    const o = weeklyOutlook("a", "KC", "Out", week, playing, { rec: 1 });
    expect(o).toMatchObject({ points: 0, availability: "out" });
  });
  it("scores healthy players", () => {
    expect(weeklyOutlook("a", "KC", null, week, playing, { rec: 1 }).points).toBe(10);
  });
});

describe("expectedStats", () => {
  it("adds the expected value of yardage bonuses", () => {
    const s = expectedStats({ rec_yd: 100 }, { bonus_rec_yd_100: 2 });
    expect(s.bonus_rec_yd_100).toBeCloseTo(0.5, 2); // mean at the threshold → 50 %
    expect(expectedStats({ rec_yd: 30 }, { bonus_rec_yd_100: 2 }).bonus_rec_yd_100).toBeLessThan(0.02);
  });

  it("spreads DEF points-allowed tiers into probabilities that sum to 1", () => {
    const scoring = {
      pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1,
      pts_allow_21_27: 0.5, pts_allow_28_34: -1, pts_allow_35p: -4,
    };
    const s = expectedStats({ pts_allow: 21, pts_allow_21_27: 1 }, scoring);
    const total = Object.keys(scoring).reduce((sum, k) => sum + (s[k] ?? 0), 0);
    expect(total).toBeCloseTo(1, 3);
    expect(s.pts_allow_21_27).toBeLessThan(0.5); // no longer a certain single bucket
    expect(s.pts_allow_0).toBeGreaterThan(0);
  });

  it("gives a better DEF more expected points", () => {
    const scoring = { pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4 };
    expect(scoreProjection({ pts_allow: 14 }, scoring)).toBeGreaterThan(scoreProjection({ pts_allow: 28 }, scoring));
  });
});
