import { localUiUrl } from '../../../../ci/ui-tests.mjs';

const cleanups = new WeakMap();
// Two bounded fetches plus the maximum accepted Retry-After and timer margin.
export const readBudgetTimeout = 2 * 10000 + 60000 + 100 + 5000;

export async function finishReadBudget(context) {
  await cleanups.get(context)?.();
}

// All browser cases share the disposable Worker's loopback IP budget. Honor
// real backpressure on reads; never retry reserve/capture/release or auth writes.
// Optional identities isolate only local reads, never writes or guest/player limits.
export async function respectReadBudget(context, testInfo, { address, label = 'shared', phase = () => 'read' } = {}) {
  const pattern = /\/api\/platform\/(bootstrap|credits)$/;
  const pending = new Set();
  const wakeups = new Set();
  let closing = false;
  const handle = async route => {
    const request = route.request();
    if (!localUiUrl(request.url()) || request.method() !== 'GET') return route.fallback();
    if (closing) return route.abort();
    const options = { maxRedirects: 0, maxRetries: 0, timeout: 10000,
      ...(address ? { headers: { ...request.headers(), 'cf-connecting-ip': address } } : {}),
    };
    const stage = `${label}/${phase()}`;
    let response = await route.fetch(options);
    try {
      const retryAfter = Number(response.headers()['retry-after']);
      if (response.status() === 429 && Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 60) {
        const delay = retryAfter * 1000 + 100;
        testInfo.setTimeout(testInfo.timeout + delay + 5000);
        testInfo.annotations.push({ type: 'local-api-backpressure', description: `${stage} ${new URL(request.url()).pathname}: ${retryAfter}s` });
        await response.dispose();
        await new Promise(resolve => {
          const wake = () => { clearTimeout(timer); wakeups.delete(wake); resolve(); };
          const timer = setTimeout(wake, delay);
          wakeups.add(wake);
          if (closing) wake();
        });
        if (closing) return await route.abort();
        response = await route.fetch(options);
        testInfo.annotations.push({ type: 'local-api-backpressure-retry',
          description: `${stage} ${new URL(request.url()).pathname}: ${response.status()}` });
      }
      // Deliver the actual Worker status/body/cookies, including any remaining
      // error. No successful response, balance or authorization is fabricated.
      await route.fulfill({ response });
    } finally {
      await response.dispose();
    }
  };
  const handler = async route => {
    const task = handle(route);
    pending.add(task);
    try { await task; } finally { pending.delete(task); }
  };
  await context.route(pattern, handler);
  cleanups.set(context, async () => {
    closing = true;
    for (const wake of wakeups) wake();
    // Fetches have a 10s bound. Do not close the context while one owns a route,
    // and propagate failures rather than silencing route callback errors.
    while (pending.size) await Promise.all([...pending]);
    // Keep the handler registered until its owned routes have settled. Unroute
    // must not race a retry wakeup or a fetch delivering its actual response.
    await context.unroute(pattern, handler);
    while (pending.size) await Promise.all([...pending]);
    cleanups.delete(context);
  });
}
