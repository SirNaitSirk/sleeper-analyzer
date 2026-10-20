import { describe, expect, it } from "vitest";
import { buildPicks } from "./picks";

const values = { "2027-1-early": 4000, "2027-1-mid": 3000, "2027-1-late": 2000, "2027-1": 2800, "2028-1": 2000, "2027-2": 1000 };

describe("buildPicks", () => {
  const picks = buildPicks({
    season: "2026",
    draftDone: true,
    rounds: 2,
    rosterIds: [1, 2, 3],
    traded: [{ season: "2027", round: 1, roster_id: 1, owner_id: 3, previous_owner_id: 1 }],
    pickValues: values,
    weakestFirst: [1, 2, 3],
  });

  it("applies trades and keeps untraded picks with their original team", () => {
    const p = picks.find((x) => x.id === "pick:2027:1:1")!;
    expect(p.ownerRosterId).toBe(3);
    expect(picks.find((x) => x.id === "pick:2027:1:2")!.ownerRosterId).toBe(2);
  });

  it("values the weakest team's pick as early", () => {
    expect(picks.find((x) => x.id === "pick:2027:1:1")!).toMatchObject({ tier: "early", value: 4000 });
    expect(picks.find((x) => x.id === "pick:2027:1:3")!).toMatchObject({ tier: "late", value: 2000 });
  });

  it("uses generic values for later years and skips rounds without a market", () => {
    expect(picks.find((x) => x.id === "pick:2028:1:2")!).toMatchObject({ tier: null, value: 2000 });
    expect(picks.some((x) => x.id.startsWith("pick:2028:2"))).toBe(false);
  });

  it("skips the current season once its draft is done", () => {
    expect(picks.some((x) => x.season === "2026")).toBe(false);
  });
});
