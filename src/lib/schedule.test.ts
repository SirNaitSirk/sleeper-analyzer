import { describe, expect, it } from "vitest";
import { lockedTeams, type Game } from "./schedule";

const g = (home: string, away: string, status: string, date: string, week = 3): Game => ({ home, away, status, date, week });

describe("lockedTeams", () => {
  const now = new Date("2026-09-27T18:00:00Z"); // Sunday afternoon US
  it("locks teams whose game started or finished", () => {
    const locked = lockedTeams([g("GB", "ATL", "complete", "2026-09-24"), g("BUF", "LAC", "in_game", "2026-09-27"), g("CHI", "PHI", "pre_game", "2026-09-28")], 3, now);
    expect([...locked].sort()).toEqual(["ATL", "BUF", "GB", "LAC"]);
  });
  it("falls back to the date when the status lags behind", () => {
    expect(lockedTeams([g("GB", "ATL", "pre_game", "2026-09-24")], 3, now).has("GB")).toBe(true);
  });
  it("ignores other weeks", () => {
    expect(lockedTeams([g("GB", "ATL", "complete", "2026-09-17", 2)], 3, now).size).toBe(0);
  });
});
