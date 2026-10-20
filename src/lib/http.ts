export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET JSON with a timeout and retries on network errors, 429 and 5xx.
 * 4xx (other than 429) fail immediately since retrying won't help.
 */
export async function fetchJson<T>(
  url: string,
  { timeoutMs = 15000, retries = 2 }: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        const err = new HttpError(`${res.status} ${res.statusText} for ${url}`, res.status);
        if (res.status !== 429 && res.status < 500) throw err;
        lastError = err;
      } else {
        return (await res.json()) as T;
      }
    } catch (e) {
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
      lastError = e;
    }
    if (attempt < retries) await sleep(500 * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
