import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const sha = 'a'.repeat(40);
const load = source => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('stamped gateway retains backend identity and adds its own identity', async () => {
  const source = await readFile(new URL('../../apps/web/src/pages/gateway.mjs', import.meta.url), 'utf8');
  const { default: gateway } = await load(source.replace('__PULBASE_GATEWAY_REVISION__', sha));
  const response = await gateway.fetch(new Request('https://develop.virtual-gamecenter.pages.dev/'), {
    APP_ENV: 'staging', BACKEND: { fetch: async () => new Response('ok', { headers: { 'X-Pulbase-Revision': sha } }) },
  });
  assert.equal(response.headers.get('X-Pulbase-Gateway-Revision'), sha);
  assert.equal(response.headers.get('X-Pulbase-Revision'), sha);
  assert.equal(await response.text(), 'ok');
  const mismatch = await gateway.fetch(new Request('https://pulbase.com/'), { APP_ENV: 'staging', BACKEND: { fetch() { throw Error('must not call'); } } });
  assert.equal(mismatch.status, 403);
});
