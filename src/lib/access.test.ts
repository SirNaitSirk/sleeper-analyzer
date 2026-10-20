import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { berlinDay, consumeQuota, leagueAllowed, parseCookie, remainingQuota } from "./access";
import { fileKV, type KV } from "./kv";
import { signToken, verifyToken } from "./token";

describe("invite token", () => {
  it("verifies its own signature", () => {
    const t = signToken("s3cret", "123");
    expect(verifyToken("s3cret", "123", t)).toBe(true);
  });

  it("rejects other users, other secrets and garbage", () => {
    const t = signToken("s3cret", "123");
    expect(verifyToken("s3cret", "124", t)).toBe(false);
    expect(verifyToken("other", "123", t)).toBe(false);
    expect(verifyToken("s3cret", "123", t.slice(1))).toBe(false);
    expect(verifyToken("s3cret", "123", "")).toBe(false);
    expect(verifyToken("", "123", t)).toBe(false);
  });

  it("parses the cookie value", () => {
    expect(parseCookie("123.abc.def")).toEqual({ userId: "123", token: "abc.def" });
    expect(parseCookie("nodot")).toBeNull();
    expect(parseCookie(undefined)).toBeNull();
  });
});

describe("league whitelist", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows every league when unset", () => {
    vi.stubEnv("ALLOWED_LEAGUE_IDS", "");
    expect(leagueAllowed("1")).toBe(true);
  });

  it("allows only listed leagues", () => {
    vi.stubEnv("ALLOWED_LEAGUE_IDS", "1, 2");
    expect(leagueAllowed("2")).toBe(true);
    expect(leagueAllowed("3")).toBe(false);
  });
});

describe("daily limit", () => {
  let store: KV;
  beforeEach(() => {
    store = fileKV(mkdtempSync(path.join(tmpdir(), "kv-")));
    vi.stubEnv("ADVICE_DAILY_LIMIT", "2");
    vi.stubEnv("ADVICE_ADMIN_USER_IDS", "admin");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("counts down and blocks at the limit", async () => {
    expect(await remainingQuota("u", store)).toBe(2);
    expect(await consumeQuota("u", store)).toMatchObject({ ok: true, remaining: 1 });
    expect(await consumeQuota("u", store)).toMatchObject({ ok: true, remaining: 0 });
    expect(await consumeQuota("u", store)).toMatchObject({ ok: false, remaining: 0 });
    // A rejected attempt doesn't use anything up.
    expect(await remainingQuota("u", store)).toBe(0);
    expect(await remainingQuota("other", store)).toBe(2);
  });

  it("refunds once", async () => {
    const q = await consumeQuota("u", store);
    await q.refund();
    await q.refund();
    expect(await remainingQuota("u", store)).toBe(2);
  });

  it("does not limit admins", async () => {
    for (let i = 0; i < 5; i++) expect((await consumeQuota("admin", store)).ok).toBe(true);
    expect(await remainingQuota("admin", store)).toBeNull();
  });

  it("defaults to 3 per day", async () => {
    vi.stubEnv("ADVICE_DAILY_LIMIT", "");
    expect(await remainingQuota("u", store)).toBe(3);
  });

  it("uses the German calendar day", () => {
    // 23:30 UTC on 1 Jan is already 2 Jan in Berlin.
    expect(berlinDay(new Date("2026-01-01T23:30:00Z"))).toBe("2026-01-02");
  });
});

describe("file KV", () => {
  it("keeps lists newest first and trimmed", async () => {
    const store = fileKV(mkdtempSync(path.join(tmpdir(), "kv-")));
    for (const v of ["a", "b", "c"]) await store.lpush("l", v, 2);
    expect(await store.lrange("l")).toEqual(["c", "b"]);
  });

  it("expires values", async () => {
    const store = fileKV(mkdtempSync(path.join(tmpdir(), "kv-")));
    vi.useFakeTimers({ toFake: ["Date"] });
    await store.set("k", "v", 10);
    expect(await store.get("k")).toBe("v");
    vi.setSystemTime(Date.now() + 11_000);
    expect(await store.get("k")).toBeNull();
    vi.useRealTimers();
  });
});
