import { promises as fs } from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";

/**
 * Minimal key-value store: Upstash Redis when configured (Vercel), otherwise
 * JSON files in CACHE_DIR so local `npm run dev` works without any setup.
 */
export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  /** Increments and returns the new value; the TTL is set on first increment. */
  incr(key: string, ttlSec: number): Promise<number>;
  decr(key: string): Promise<number>;
  /** Prepends to a list and keeps at most `max` items. */
  lpush(key: string, value: string, max: number): Promise<void>;
  /** All list items, newest first. */
  lrange(key: string): Promise<string[]>;
}

// Serverless filesystems are read-only except /tmp.
export const CACHE_DIR =
  process.env.CACHE_DIR ?? (process.env.VERCEL ? "/tmp/sleeper-cache" : path.join(process.cwd(), ".cache"));

const fileFor = (dir: string, key: string) => path.join(dir, key.replace(/[^a-zA-Z0-9_.-]/g, "_") + ".json");

interface FileEntry {
  value: unknown;
  expiresAt: number | null;
}

/** File-backed store. Not atomic across processes – fine for a single dev server. */
export function fileKV(dir = path.join(CACHE_DIR, "kv")): KV {
  async function read(key: string): Promise<unknown> {
    try {
      const e = JSON.parse(await fs.readFile(fileFor(dir, key), "utf8")) as FileEntry;
      return e.expiresAt !== null && e.expiresAt <= Date.now() ? null : e.value;
    } catch {
      return null;
    }
  }
  async function write(key: string, value: unknown, ttlSec?: number) {
    await fs.mkdir(dir, { recursive: true });
    const entry: FileEntry = { value, expiresAt: ttlSec ? Date.now() + ttlSec * 1000 : null };
    const tmp = `${fileFor(dir, key)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(entry));
    await fs.rename(tmp, fileFor(dir, key));
  }
  async function expiry(key: string): Promise<number | undefined> {
    try {
      const e = JSON.parse(await fs.readFile(fileFor(dir, key), "utf8")) as FileEntry;
      return e.expiresAt ? Math.max(1, Math.ceil((e.expiresAt - Date.now()) / 1000)) : undefined;
    } catch {
      return undefined;
    }
  }

  return {
    async get(key) {
      const v = await read(key);
      // Counters are stored as numbers; Redis returns them as strings too.
      return typeof v === "string" || typeof v === "number" ? String(v) : null;
    },
    set: (key, value, ttlSec) => write(key, value, ttlSec),
    async incr(key, ttlSec) {
      const n = (Number(await read(key)) || 0) + 1;
      await write(key, n, n === 1 ? ttlSec : await expiry(key));
      return n;
    },
    async decr(key) {
      const n = (Number(await read(key)) || 0) - 1;
      await write(key, n, await expiry(key));
      return n;
    },
    async lpush(key, value, max) {
      const list = await read(key);
      await write(key, [value, ...(Array.isArray(list) ? list : [])].slice(0, max));
    },
    async lrange(key) {
      const list = await read(key);
      return Array.isArray(list) ? (list as string[]) : [];
    },
  };
}

export function redisKV(redis: Redis): KV {
  return {
    get: (key) => redis.get<string>(key),
    async set(key, value, ttlSec) {
      await (ttlSec ? redis.set(key, value, { ex: ttlSec }) : redis.set(key, value));
    },
    async incr(key, ttlSec) {
      const [n] = await redis.multi().incr(key).expire(key, ttlSec, "NX").exec<[number, number]>();
      return n;
    },
    decr: (key) => redis.decr(key),
    async lpush(key, value, max) {
      await redis.multi().lpush(key, value).ltrim(key, 0, max - 1).exec();
    },
    lrange: (key) => redis.lrange<string>(key, 0, -1),
  };
}

const redisUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

/** true when data survives restarts/deploys (Redis) rather than living on local disk. */
export const hasRedis = !!(redisUrl && redisToken);

export const kv: KV = hasRedis
  ? // Values are stored as plain strings; we (de)serialize JSON ourselves.
    redisKV(new Redis({ url: redisUrl!, token: redisToken!, automaticDeserialization: false }))
  : fileKV();
