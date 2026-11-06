import { expect } from '../../../../ci/ui-fixtures.mjs';
import { localUiUrl } from '../../../../ci/ui-tests.mjs';
import { readBudgetTimeout } from './api-read-budget.mjs';

// Subscribe before the write/event: wallet refresh is asynchronous and may wait
// for the shared loopback GET budget. Never retry the welcome write.
export async function claimWelcomeAndRefresh(page) {
  const refreshed = page.waitForResponse(response =>
    localUiUrl(response.url())
    && new URL(response.url()).pathname === '/api/platform/bootstrap'
    && response.request().method() === 'GET'
    && response.frame() === page.mainFrame(), { timeout: readBudgetTimeout });
  const [granted, response] = await Promise.all([
    page.evaluate(async () => {
      const result = await (await import('/src/features/platform/platform-client.ts')).claimWelcomeCredit();
      window.dispatchEvent(new Event('platform-wallet-changed'));
      return result.wallet;
    }),
    refreshed,
  ]);
  expect(response.ok()).toBe(true);
  expect((await response.json()).wallet).toEqual(granted);
  await expect(page.locator('.platform-credit-badge')).toHaveText(String(granted.availableTotal));
  return granted;
}
