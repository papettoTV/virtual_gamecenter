import { test } from 'node:test';
import assert from 'node:assert/strict';
import { respectReadBudget, finishReadBudget } from './ui/api-read-budget.mjs';

function harness(response) {
  let handler;
  const calls = [];
  const context = {
    async route(pattern, callback) { handler = callback; },
    async unroute(pattern, callback) { assert.equal(callback, handler); calls.push('unroute'); },
  };
  const route = {
    request: () => ({ url: () => 'http://127.0.0.1:5174/api/platform/credits', method: () => 'GET' }),
    async fetch(options) { calls.push(options); return response; },
    async fulfill({ response: actual }) { assert.equal(actual, response); calls.push('fulfill'); },
    async abort() { calls.push('abort'); },
    async fallback() { calls.push('fallback'); },
  };
  return { context, route, calls, run: () => handler(route) };
}
const info = () => ({ timeout: 30000, setTimeout() {}, annotations: [] });

test('cleanup drains its in-flight read before the owner closes the context', async () => {
  let release;
  const response = { status: () => 200, headers: () => ({}), async dispose() {} };
  const h = harness(response);
  h.route.fetch = async options => {
    assert.equal(options.timeout, 10000);
    await new Promise(resolve => { release = resolve; });
    return response;
  };
  await respectReadBudget(h.context, info());
  const read = h.run();
  let finished = false;
  const cleanup = finishReadBudget(h.context).then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  release();
  await Promise.all([read, cleanup]);
  assert.deepEqual(h.calls, ['fulfill', 'unroute']);
});

test('cleanup cancels a Retry-After wait without another read', async () => {
  let disposed;
  const waiting = new Promise(resolve => { disposed = resolve; });
  const response = { status: () => 429, headers: () => ({ 'retry-after': '60' }), async dispose() { disposed(); } };
  const h = harness(response);
  await respectReadBudget(h.context, info());
  const read = h.run();
  await waiting;
  await finishReadBudget(h.context);
  await read;
  assert.equal(h.calls.filter(call => typeof call === 'object').length, 1);
  assert.ok(h.calls.includes('abort'));
  assert.ok(!h.calls.includes('fulfill'));
});

test('cleanup propagates in-flight transport failures', async () => {
  let reject;
  const h = harness(null);
  h.route.fetch = () => new Promise((resolve, fail) => { reject = fail; });
  await respectReadBudget(h.context, info());
  const read = assert.rejects(h.run(), /transport failure/);
  const cleanup = assert.rejects(finishReadBudget(h.context), /transport failure/);
  reject(new Error('transport failure'));
  await Promise.all([read, cleanup]);
});

test('an isolated real 429 read preserves cookies, waits Retry-After and retries only once', async () => {
  const response = { status: () => 429, headers: () => ({ 'retry-after': '1' }), async dispose() {} };
  const h = harness(response);
  const testInfo = info();
  h.route.request = () => ({
    url: () => 'http://127.0.0.1:5174/api/platform/credits', method: () => 'GET',
    headers: () => ({ cookie: 'fake-local-session=guest', accept: 'application/json' }),
  });
  await respectReadBudget(h.context, testInfo, {
    address: 'fd00:1:2:3:4:5:6:7', label: 'player', phase: () => 'start-and-wallet',
  });
  const started = Date.now();
  await h.run();
  assert.ok(Date.now() - started >= 1000);
  const fetches = h.calls.filter(call => typeof call === 'object');
  assert.equal(fetches.length, 2);
  assert.ok(fetches.every(options => options.maxRetries === 0 && options.maxRedirects === 0));
  assert.deepEqual(fetches[0].headers, {
    cookie: 'fake-local-session=guest', accept: 'application/json',
    'cf-connecting-ip': 'fd00:1:2:3:4:5:6:7',
  });
  assert.deepEqual(fetches[1], fetches[0]);
  assert.deepEqual(testInfo.annotations, [
    { type: 'local-api-backpressure', description: 'player/start-and-wallet /api/platform/credits: 1s' },
    { type: 'local-api-backpressure-retry', description: 'player/start-and-wallet /api/platform/credits: 429' },
  ]);
  assert.ok(h.calls.includes('fulfill'));
  await finishReadBudget(h.context);
});

test('writes and external reads fall through without a fetch or retry', async () => {
  for (const [url, method] of [
    ['http://127.0.0.1:5174/api/platform/credits', 'POST'],
    ['https://example.invalid/api/platform/credits', 'GET'],
  ]) {
    const h = harness(null);
    h.route.request = () => ({ url: () => url, method: () => method });
    await respectReadBudget(h.context, info(), { address: 'fd00:1:2:3:4:5:6:7' });
    await h.run();
    assert.deepEqual(h.calls, ['fallback']);
    await finishReadBudget(h.context);
  }
});
