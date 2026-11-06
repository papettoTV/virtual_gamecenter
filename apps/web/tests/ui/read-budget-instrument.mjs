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
        route.fetch = options => intercept(() => fetch(options));
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
  return new Proxy(response, {
    get(target, key) {
      if (key === 'status') return () => 429;
      if (key === 'headers') return () => ({ ...target.headers(), 'retry-after': String(seconds) });
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

