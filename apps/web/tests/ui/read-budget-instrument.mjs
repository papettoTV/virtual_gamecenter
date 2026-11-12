import { randomUUID } from 'node:crypto';
import { localUiUrl } from '../../../../ci/ui-tests.mjs';
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
        route.fetch = options => intercept(overrides => fetch({ ...options, ...overrides }), route.request());
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
// Isolate just this probe's two real GETs from the suite's shared loopback IP
// budget. Keep cookies and player budgets unchanged, and use the same address
// for both attempts. This header is test input to the disposable local Worker,
// never a production bypass. Genuine 429s still own their full Retry-After.
export function delayedReadProbe(pathname, seconds = 6) {
  const address = `fd00:${randomUUID().replaceAll('-', '').match(/.{4}/g).slice(0, 7).join(':')}`;
  const reads = new Map();
  let selected;
  return {
    async intercept(fetch, request) {
      const attempts = reads.get(request) ?? [];
      reads.set(request, attempts);
      const inject = !selected && new URL(request.url()).pathname === pathname;
      if (inject) selected = request;
      if (!localUiUrl(request.url())) throw new Error('Read probes require the disposable local Worker');
      const response = await fetch(request === selected ? {
        headers: { ...request.headers(), 'cf-connecting-ip': address },
      } : undefined);
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
