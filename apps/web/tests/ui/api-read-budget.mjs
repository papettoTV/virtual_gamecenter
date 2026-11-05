import { localUiUrl } from '../../../../ci/ui-tests.mjs';

// All browser cases share the disposable Worker's loopback IP budget. Honor
// real backpressure on reads; never retry reserve/capture/release or auth writes.
export async function respectReadBudget(context, testInfo) {
  await context.route(/\/api\/platform\/(bootstrap|credits)$/, async route => {
    const request = route.request();
    if (!localUiUrl(request.url()) || request.method() !== 'GET') return route.fallback();
    let response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
    const retryAfter = Number(response.headers()['retry-after']);
    if (response.status() === 429 && Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 60) {
      const delay = retryAfter * 1000 + 100;
      testInfo.setTimeout(testInfo.timeout + delay + 5000);
      testInfo.annotations.push({ type: 'local-api-backpressure', description: `${new URL(request.url()).pathname}: ${retryAfter}s` });
      await response.dispose();
      await new Promise(resolve => setTimeout(resolve, delay));
      response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
    }
    // Deliver the actual Worker status/body/cookies, including any remaining
    // error. No successful response, balance or authorization is fabricated.
    await route.fulfill({ response });
    await response.dispose();
  });
}
