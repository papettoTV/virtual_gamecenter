import { localUiUrl } from '../../../../ci/ui-tests.mjs';

const cleanups = new WeakMap();

export async function finishReadBudget(context) {
  await cleanups.get(context)?.();
}

// All browser cases share the disposable Worker's loopback IP budget. Honor
// real backpressure on reads; never retry reserve/capture/release or auth writes.
export async function respectReadBudget(context, testInfo) {
  const pattern = /\/api\/platform\/(bootstrap|credits)$/;
  const pending = new Set();
  const wakeups = new Set();
  let closing = false;
  const handle = async route => {
    const request = route.request();
    if (!localUiUrl(request.url()) || request.method() !== 'GET') return route.fallback();
    if (closing) return route.abort();
    let response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 10000 });
    try {
      const retryAfter = Number(response.headers()['retry-after']);
      if (response.status() === 429 && Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 60) {
        const delay = retryAfter * 1000 + 100;
        testInfo.setTimeout(testInfo.timeout + delay + 5000);
        testInfo.annotations.push({ type: 'local-api-backpressure', description: `${new URL(request.url()).pathname}: ${retryAfter}s` });
        await response.dispose();
        await new Promise(resolve => {
          const wake = () => { clearTimeout(timer); wakeups.delete(wake); resolve(); };
          const timer = setTimeout(wake, delay);
          wakeups.add(wake);
          if (closing) wake();
        });
        if (closing) return await route.abort();
        response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 10000 });
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
    // Remove only this helper's route, preserving the local-only boundary.
    await context.unroute(pattern, handler);
    for (const wake of wakeups) wake();
    // Fetches have a 10s bound. Do not close the context while one owns a route,
    // and propagate failures rather than silencing route callback errors.
    await Promise.all([...pending]);
    cleanups.delete(context);
  });
}
