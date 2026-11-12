import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';
import { respectReadBudget, finishReadBudget, readBudgetTimeout } from './api-read-budget.mjs';

import { claimWelcomeAndRefresh } from './welcome-wallet.mjs';
import { instrument, backpressure, delayedReadProbe } from './read-budget-instrument.mjs';

test.beforeEach(async ({}, testInfo) => {
  testInfo.setTimeout(testInfo.timeout + readBudgetTimeout);
});

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

test('welcome refresh survives one Retry-After and renders the real wallet', async ({ page, context }, testInfo) => {
  test.setTimeout(120000);
  // Bootstrap the real guest, including its HttpOnly session cookie.
  await loadGuest(page, context, testInfo);
  const probe = delayedReadProbe('/api/platform/bootstrap');
  const scope = instrument(context, probe.intercept);
  await respectReadBudget(scope, testInfo);
  try {
    const wallet = await claimWelcomeAndRefresh(page);
    probe.verify();
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

// Keep one genuine limit/recovery check; only injected failures use the short
// probe delay. A fresh guest owns its player budget, so other cases cannot
// consume it while this case respects the Worker's actual Retry-After.
test('real Worker backpressure keeps its Retry-After and recovers', async ({ page, context }, testInfo) => {
  await context.setExtraHTTPHeaders({
    'cf-connecting-ip': `fd00:${randomUUID().replaceAll('-', '').match(/.{4}/g).slice(0, 7).join(':')}`,
  });
  await loadGuest(page, context, testInfo);
  let limited;
  for (let attempt = 0; attempt < 61; attempt++) {
    const response = await context.request.get(`${origin}/api/platform/bootstrap`);
    if (response.status() === 429) {
      limited = response;
      break;
    }
    expect(response.status()).toBe(200);
    await response.dispose();
  }
  expect(limited, 'real bootstrap budget must be exhausted').toBeDefined();
  const retryAfter = Number(limited.headers()['retry-after']);
  expect(Number.isInteger(retryAfter)).toBe(true);
  expect(retryAfter).toBeGreaterThan(0);
  expect(retryAfter).toBeLessThanOrEqual(60);
  await limited.dispose();

  let realLimits = 0;
  const probe = delayedReadProbe('/api/platform/bootstrap');
  // Deliberately omit the probe's IP override here: both fetches must hit the
  // exhausted real budget. backpressure returns genuine 429s unchanged.
  const scope = instrument(context, (fetch, request) => probe.intercept(async () => {
    const response = await fetch();
    if (response.status() === 429) realLimits++;
    return response;
  }, request));
  await respectReadBudget(scope, testInfo);
  try {
    const result = await page.evaluate(async () => {
      const response = await fetch('/api/platform/bootstrap');
      return { status: response.status, wallet: (await response.json()).wallet };
    });
    expect(realLimits).toBe(1);
    probe.verify();
    expect(result.status).toBe(200);
    await expect(page.locator('.platform-credit-badge')).toHaveText(String(result.wallet.availableTotal));
  } finally {
    await finishReadBudget(scope);
  }
});
