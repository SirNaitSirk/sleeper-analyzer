import { describe, expect, it } from "vitest";
import { optimalLineup } from "./lineup";

const c = (id: string, pos: string, score: number) => ({ id, positions: [pos], score });

describe("optimalLineup", () => {
  it("fills flex with the best leftover player", () => {
    const r = optimalLineup(
      ["QB", "RB", "WR", "FLEX"],
      [c("q", "QB", 20), c("r1", "RB", 15), c("r2", "RB", 12), c("w1", "WR", 10), c("w2", "WR", 8)],
    );
    expect(r.slots.map((s) => s.playerId)).toEqual(["q", "r1", "w1", "r2"]);
    expect(r.total).toBe(57);
  });

  it("beats greedy when a flex choice blocks a dedicated slot", () => {
    // Greedy filling SUPER_FLEX first would take the QB and leave QB slot to a worse one.
    const r = optimalLineup(
      ["SUPER_FLEX", "QB", "WR"],
      [c("q1", "QB", 25), c("q2", "QB", 5), c("w1", "WR", 20), c("w2", "WR", 18)],
    );
    expect(r.total).toBe(25 + 20 + 18);
  });

  it("leaves slots empty when nobody is eligible", () => {
    const r = optimalLineup(["QB", "K"], [c("q", "QB", 10)]);
    expect(r.slots[1].playerId).toBeNull();
    expect(r.total).toBe(10);
  });

  it("handles multi-position players", () => {
    const r = optimalLineup(
      ["RB", "WR"],
      [{ id: "x", positions: ["RB", "WR"], score: 10 }, c("r", "RB", 9)],
    );
    expect(Object.fromEntries(r.slots.map((s) => [s.slot, s.playerId]))).toEqual({ RB: "r", WR: "x" });
  });
});
