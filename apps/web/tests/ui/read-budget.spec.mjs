import { test, expect } from '../../../../ci/ui-fixtures.mjs';
import { respectReadBudget, finishReadBudget, readBudgetTimeout } from './api-read-budget.mjs';

const origin = 'http://127.0.0.1:5174';
async function loadGuest(page, context, testInfo) {
  await respectReadBudget(context, testInfo);
  const loaded = page.waitForResponse(response => response.url() === `${origin}/api/platform/bootstrap`, { timeout: readBudgetTimeout });
  await page.goto(origin);
  const response = await loaded;
  expect(response.ok()).toBe(true);
  const account = await response.json();
  await expect(page.locator('.platform-credit-badge')).toHaveText(String(account.wallet.availableTotal));
  await finishReadBudget(context);
}

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// Instrument actual Playwright Routes, not a fake route lifecycle. Every fetch
// still reaches the disposable Worker; only the first read's backpressure is
// injected, so this is deterministic without exhausting other cases' IP budget.
function instrument(context, intercept) {
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
function backpressure(response, seconds) {
  return new Proxy(response, {
    get(target, key) {
      if (key === 'status') return () => 429;
      if (key === 'headers') return () => ({ ...target.headers(), 'retry-after': String(seconds) });
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

test('welcome refresh survives one Retry-After and renders the real wallet', async ({ page, context }, testInfo) => {
  test.setTimeout(120000);
  // Bootstrap the real guest, including its HttpOnly session cookie.
  await loadGuest(page, context, testInfo);
  const reads = [];
  const scope = instrument(context, async fetch => {
    const response = await fetch();
    reads.push(response.status());
    return reads.length === 1 ? backpressure(response, 6) : response;
  });
  await respectReadBudget(scope, testInfo);
  try {
    const refreshed = page.waitForResponse(response => response.url() === `${origin}/api/platform/bootstrap`, { timeout: readBudgetTimeout });
    const started = Date.now();
    const wallet = await page.evaluate(async () => {
      const { claimWelcomeCredit } = await import('/src/features/platform/platform-client.ts');
      const result = await claimWelcomeCredit();
      window.dispatchEvent(new Event('platform-wallet-changed'));
      return result.wallet;
    });
    const response = await refreshed;
    expect(response.ok()).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(6000);
    expect(reads).toEqual([200, 200]);
    expect((await response.json()).wallet).toEqual(wallet);
    await expect(page.locator('.platform-credit-badge')).toHaveText(String(wallet.availableTotal));
    const persisted = await page.evaluate(async () => (await (await fetch('/api/platform/credits')).json()).wallet);
    expect(persisted).toEqual(wallet);
  } finally {
    await finishReadBudget(scope);
  }
});

for (const waiting of ['fetch', 'retry']) {
  test(`cleanup owns a real route until ${waiting} settles`, async ({ page, context }, testInfo) => {
    await loadGuest(page, context, testInfo);
    const entered = deferred();
    const release = deferred();
    let fetches = 0;
    const scope = instrument(context, async fetch => {
      fetches++;
      const response = await fetch();
      expect(response.ok()).toBe(true);
      entered.resolve();
      if (waiting === 'fetch') await release.promise;
      return waiting === 'retry' ? backpressure(response, 60) : response;
    });
    await respectReadBudget(scope, testInfo);
    const read = page.evaluate(async () => {
      try {
        const response = await fetch('/api/platform/credits');
        return { status: response.status, wallet: (await response.json()).wallet };
      } catch {
        // Only the explicitly cancelled retry may reject in the browser.
        return { cancelled: true };
      }
    });
    await entered.promise;
    const finishing = finishReadBudget(scope);
    release.resolve();
    await finishing;
    const result = await read;
    if (waiting === 'retry') expect(result).toEqual({ cancelled: true });
    else {
      expect(result.status).toBe(200);
      expect(result.wallet.availableTotal).toBeGreaterThanOrEqual(0);
    }
    expect(fetches).toBe(1);
    // Removing our handler leaves the existing local-only boundary in place.
    expect(await page.evaluate(async () => (await fetch('/api/health')).ok)).toBe(true);
    await finishReadBudget(scope);
  });
}
