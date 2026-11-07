import { expect } from '../../../../ci/ui-fixtures.mjs';

// Instrument actual Playwright Routes, not a fake route lifecycle. Every fetch
// still reaches the disposable Worker; only the first read's backpressure is
// injected, so this is deterministic without exhausting other cases' IP budget.
export function instrument(context, intercept) {
  let wrapped;
  let owner;
  let owned = 0;
  return {
    async route(pattern, handler) {
      owner = handler;
      wrapped = async route => {
        owned++;
        const fetch = route.fetch.bind(route);
        route.fetch = options => intercept(() => fetch(options), route.request());
        try { await handler(route); } finally { owned--; }
      };
      await context.route(pattern, wrapped);
    },
    async unroute(pattern, handler) {
      expect(handler).toBe(owner);
      expect(owned, 'unroute must follow completion of owned Playwright routes').toBe(0);
      await context.unroute(pattern, wrapped);
    },
  };
}
export function backpressure(response, seconds) {
  // A genuine Worker limit owns its Retry-After; never shorten it.
  if (response.status() === 429) return response;
  return new Proxy(response, {
    get(target, key) {
      if (key === 'status') return () => 429;
      if (key === 'headers') return () => ({ ...target.headers(), 'retry-after': String(seconds) });
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}


// Observe each browser GET separately, including its one permitted route retry.
// A successful first fetch may spend the actor's last read in the Worker's
// minute window (AbuseGuard.consume). An artificial 6s delay can then make the
// sole retry hit a genuine 429 in that same window. Give injected backpressure
// a full window, within readBudgetTimeout, so the retry gets a fresh budget.
// backpressure still preserves a genuine 429 and its actual Retry-After.
export function delayedReadProbe(pathname, seconds = 60) {
  const reads = new Map();
  let selected;
  return {
    async intercept(fetch, request) {
      const attempts = reads.get(request) ?? [];
      reads.set(request, attempts);
      const inject = !selected && new URL(request.url()).pathname === pathname;
      if (inject) selected = request;
      const response = await fetch();
      const at = Date.now();
      const delivered = inject ? backpressure(response, seconds) : response;
      attempts.push({ status: response.status(), at,
        artificial: delivered !== response,
        retryAfter: Number(delivered.headers()['retry-after']) });
      return delivered;
    },
    verify() {
      expect(selected, 'the intended browser GET was observed').toBeDefined();
      for (const [request, attempts] of reads) {
        expect(request.method()).toBe('GET');
        expect(attempts.length).toBeLessThanOrEqual(2);
        // Other concurrent GETs may still be waiting; their outcomes are
        // checked by their callers, never pooled with the selected refresh.
        if (request !== selected) continue;
        expect(attempts.at(-1).status).toBe(200);
        if (attempts.length === 2) {
          const first = attempts[0];
          expect(first.artificial ? first.status === 200 : first.status === 429).toBe(true);
          expect(first.retryAfter).toBeGreaterThan(0);
          expect(first.retryAfter).toBeLessThanOrEqual(60);
          expect(attempts[1].at - first.at).toBeGreaterThanOrEqual(first.retryAfter * 1000);
        }
      }
      expect(reads.get(selected)).toHaveLength(2);
    },
  };
}
