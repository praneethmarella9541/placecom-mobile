/**
 * API request tracing for optimisation work.
 *
 * Enabled when:
 *   - running a dev build (`__DEV__`), unless EXPO_PUBLIC_DEBUG_API=0
 *   - or EXPO_PUBLIC_DEBUG_API=1 in any build
 *
 * In Metro / Xcode / Android Studio logs, filter by `[api]`.
 * In the JS debugger console, call `printApiDebugSummary()` for grouped totals.
 */

type ApiDebugStats = {
  count: number;
  totalMs: number;
  errors: number;
};

const stats = new Map<string, ApiDebugStats>();
const tagStack: string[] = [];
let requestSeq = 0;

export function isApiDebugEnabled(): boolean {
  const flag = process.env.EXPO_PUBLIC_DEBUG_API;
  if (flag === '0') return false;
  if (flag === '1') return true;
  return __DEV__;
}

/** Wrap prefetch / warm paths so logs show the caller (e.g. mail-body-prefetch). */
export function withApiDebugTag<T>(tag: string, fn: () => T): T {
  if (!isApiDebugEnabled()) return fn();
  tagStack.push(tag);
  try {
    return fn();
  } finally {
    tagStack.pop();
  }
}

export async function withApiDebugTagAsync<T>(tag: string, fn: () => Promise<T>): Promise<T> {
  if (!isApiDebugEnabled()) return fn();
  tagStack.push(tag);
  try {
    return await fn();
  } finally {
    tagStack.pop();
  }
}

function currentTag(): string | undefined {
  return tagStack[tagStack.length - 1];
}

/** Collapse ids so prefetch spam groups as one route. */
export function normalizeApiPath(url: string): string {
  try {
    const u = new URL(url, 'https://local');
    let path = u.pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
      .replace(/\/[A-Za-z0-9_-]{12,}/g, '/:id');
    return path + (u.search || '');
  } catch {
    return url;
  }
}

function statKey(method: string, path: string, tag?: string): string {
  return tag ? `${method} ${path} [${tag}]` : `${method} ${path}`;
}

function bumpStat(key: string, ms: number, ok: boolean): void {
  const prev = stats.get(key) ?? { count: 0, totalMs: 0, errors: 0 };
  stats.set(key, {
    count: prev.count + 1,
    totalMs: prev.totalMs + ms,
    errors: prev.errors + (ok ? 0 : 1),
  });
}

let loggedHint = false;

function logHintOnce(): void {
  if (loggedHint || !isApiDebugEnabled()) return;
  loggedHint = true;
  console.log(
    '[api] debug logging on — filter logs by `[api]`, or run printApiDebugSummary() in the console'
  );
}

export function traceApiRequestStart(
  method: string,
  url: string,
  opts?: { tag?: string }
): { finish: (status: number, ok: boolean) => void } {
  if (!isApiDebugEnabled()) {
    return { finish: () => {} };
  }

  logHintOnce();
  const started = Date.now();
  const seq = ++requestSeq;
  const path = normalizeApiPath(url);
  const tag = opts?.tag ?? currentTag();

  return {
    finish(status: number, ok: boolean) {
      const ms = Date.now() - started;
      const tagSuffix = tag ? ` [${tag}]` : '';
      const level = ok ? 'log' : 'warn';
      console[level](
        `[api] #${seq} ${method} ${path} ${ms}ms ${status}${tagSuffix}`
      );
      bumpStat(statKey(method, path, tag), ms, ok);
    },
  };
}

/** Log direct Google API calls (Gmail / Drive) that bypass the Placecom backend. */
export function traceExternalApiRequest(
  method: string,
  url: string,
  opts?: { tag?: string }
): { finish: (status: number, ok: boolean) => void } {
  const path = normalizeApiPath(url);
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return 'google';
    }
  })();
  return traceApiRequestStart(method, `https://${host}${path}`, {
    tag: opts?.tag ?? 'google-direct',
  });
}

export function printApiDebugSummary(): void {
  if (!isApiDebugEnabled() || stats.size === 0) return;

  const rows = Array.from(stats.entries())
    .map(([route, s]) => ({
      route,
      count: s.count,
      avgMs: Math.round(s.totalMs / s.count),
      errors: s.errors,
    }))
    .sort((a, b) => b.count - a.count);

  const total = rows.reduce((n, r) => n + r.count, 0);
  console.log(`[api] summary — ${total} requests`);
  for (const row of rows.slice(0, 30)) {
    console.log(`  ${row.count}x avg ${row.avgMs}ms err ${row.errors} — ${row.route}`);
  }
  if (rows.length > 30) {
    console.log(`  … and ${rows.length - 30} more routes`);
  }
}

/** Attach to global so it is callable from the RN debugger console. */
export function installApiDebugConsoleHelper(): void {
  if (!isApiDebugEnabled()) return;
  const g = globalThis as typeof globalThis & { printApiDebugSummary?: () => void };
  g.printApiDebugSummary = printApiDebugSummary;
}

export function resetApiDebugStats(): void {
  stats.clear();
  requestSeq = 0;
}
