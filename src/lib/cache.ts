import { CACHE_DIR, fileKV, hasRedis, kv } from "./kv";

export interface Cached<T> {
  data: T;
  fetchedAt: number;
  /** true when the refresh failed and older data is served instead */
  stale: boolean;
}

interface Entry<T> {
  data: T;
  fetchedAt: number;
}

// Survive dev-server HMR module reloads.
const g = globalThis as unknown as {
  __sleeperMem?: Map<string, Entry<unknown>>;
  __sleeperInflight?: Map<string, Promise<Cached<unknown>>>;
};
const mem = (g.__sleeperMem ??= new Map());
const inflight = (g.__sleeperInflight ??= new Map());

// Larger entries (the player DB) stay on local disk – on Vercel that is /tmp,
// which survives only as long as the instance, but it is refetched cheaply.
const MAX_KV_BYTES = 900_000;
const disk = fileKV(CACHE_DIR);

async function readDisk<T>(key: string): Promise<Entry<T> | null> {
  try {
    const raw = (hasRedis ? await kv.get(`cache:${key}`) : null) ?? (await disk.get(key));
    return raw ? (JSON.parse(raw) as Entry<T>) : null;
  } catch {
    return null;
  }
}

async function writeDisk<T>(key: string, entry: Entry<T>) {
  try {
    const raw = JSON.stringify(entry);
    if (hasRedis && raw.length <= MAX_KV_BYTES) await kv.set(`cache:${key}`, raw);
    else await disk.set(key, raw);
  } catch (e) {
    // Read-only filesystem or Redis down – memory cache still works.
    console.warn(`[cache] could not persist ${key}:`, e);
  }
}

/**
 * Memory → disk → loader. If the loader fails, any older copy is returned
 * with `stale: true` so the app keeps working when an upstream API is down.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  { persist = false }: { persist?: boolean } = {},
): Promise<Cached<T>> {
  const now = Date.now();
  const m = mem.get(key) as Entry<T> | undefined;
  if (m && now - m.fetchedAt < ttlMs) return { ...m, stale: false };

  const running = inflight.get(key) as Promise<Cached<T>> | undefined;
  if (running) return running;

  const p = (async (): Promise<Cached<T>> => {
    const disk = persist && !m ? await readDisk<T>(key) : null;
    if (disk && now - disk.fetchedAt < ttlMs) {
      mem.set(key, disk);
      return { ...disk, stale: false };
    }
    try {
      const entry: Entry<T> = { data: await loader(), fetchedAt: Date.now() };
      mem.set(key, entry);
      if (persist) await writeDisk(key, entry);
      return { ...entry, stale: false };
    } catch (e) {
      const old = m ?? disk ?? (persist ? await readDisk<T>(key) : null);
      if (old) {
        console.warn(`[cache] refresh of ${key} failed, serving stale data:`, e);
        return { ...old, stale: true };
      }
      throw e;
    }
  })();

  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}
