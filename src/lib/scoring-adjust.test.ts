import { describe, expect, it } from "vitest";
import { referenceScoring, scoringFactors } from "./scoring-adjust";

const perGame = {
  te: { rec: 6, rec_yd: 60, rec_td: 0.5 },
  wr1: { rec: 6, rec_yd: 80, rec_td: 0.5 },
  wr2: { rec: 5, rec_yd: 70, rec_td: 0.4 },
  rb: { rush_yd: 70, rush_td: 0.6, rec: 3, rec_yd: 20 },
};
// scoringFactors reads position-specific bonuses from the stat line, like Sleeper projections do
const withTeBonus = { ...perGame, te: { ...perGame.te, bonus_rec_te: 6 } };

describe("scoringFactors", () => {
  it("is neutral when the league uses the reference scoring", () => {
    const f = scoringFactors(perGame, referenceScoring(1), 1);
    for (const v of Object.values(f)) expect(v).toBeCloseTo(1, 5);
  });

  it("raises TE values in TE-premium leagues", () => {
    const f = scoringFactors(withTeBonus, { ...referenceScoring(1), bonus_rec_te: 0.5 }, 1);
    expect(f.te).toBeGreaterThan(1.1);
    expect(f.wr1).toBeCloseTo(1, 1);
  });

  it("ignores uniform scoring differences", () => {
    const doubled = Object.fromEntries(Object.entries(referenceScoring(1)).map(([k, v]) => [k, v * 2]));
    for (const v of Object.values(scoringFactors(perGame, doubled, 1))) expect(v).toBeCloseTo(1, 5);
  });
});
