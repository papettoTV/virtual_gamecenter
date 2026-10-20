import { test } from 'node:test';
import assert from 'node:assert/strict';
import { announce, announcementText, oauthHeader, githubState } from '../announce-x.mjs';
const sha = 'a'.repeat(40);
const credentials = { apiKey: 'example', apiSecret: 'example', accessToken: 'example', accessSecret: 'example' };
function fixture(initial) {
  let value = initial;
  const writes = [];
  return { writes, read: async () => value, reserve: async (_sha, data) => { if (value) throw Error('conflict'); writes.push(data.status); value = data; },
    finish: async (_sha, data) => { writes.push(data.status); value = data; } };
}
test('X posting reserves state before sending; rerun does not post again', async () => {
  const state = fixture(); let calls = 0;
  const request = async (_url, options) => {
    calls++; assert.deepEqual(state.writes, ['pending']); assert.equal(options.redirect, 'error');
    assert.match(options.headers.Authorization, /^OAuth /);
    return Response.json({ data: { id: '123' } });
  };
  const options = { sha, text: 'PULBASEを更新しました。', state, credentials, confirmed: true, request };
  assert.equal((await announce(options)).status, 'sent');
  assert.equal((await announce(options)).status, 'already-sent');
  assert.equal(calls, 1);
});
test('ambiguous response stops retries and persists uncertain state', async () => {
  const state = fixture(); let calls = 0;
  const options = { sha, text: '更新しました', state, credentials, confirmed: true, request: async () => { calls++; throw Error('timeout'); } };
  await assert.rejects(announce(options));
  assert.deepEqual(state.writes, ['pending', 'uncertain']);
  await assert.rejects(announce(options)); assert.equal(calls, 1);
});
test('reservation race or missing regression prevents outbound post', async () => {
  const state = fixture();
  state.reserve = async () => { throw Error('conflict'); };
  let calls = 0;
  const options = { sha, text: '更新', state, credentials, confirmed: true, request: async () => { calls++; } };
  await assert.rejects(announce(options));
  await assert.rejects(announce({ ...options, confirmed: false }));
  assert.equal(calls, 0);
});
test('success with a failed receipt write stays pending and cannot be automatically retried', async () => {
  const state = fixture(); state.finish = async () => { throw Error('GitHub unavailable'); };
  let calls = 0;
  const options = { sha, text: '更新', state, credentials, confirmed: true,
    request: async () => { calls++; return Response.json({ data: { id: '123' } }); } };
  await assert.rejects(announce(options)); await assert.rejects(announce(options)); assert.equal(calls, 1);
});
test('conservative message limit and deterministic OAuth signature', () => {
  assert.equal(announcementText('更新'), '更新');
  assert.throws(() => announcementText('あ'.repeat(141)));
  assert.throws(() => announcementText(''));
  const header = oauthHeader(credentials, { nonce: 'nonce', timestamp: '1000' });
  assert.equal(header, oauthHeader(credentials, { nonce: 'nonce', timestamp: '1000' }));
  assert.match(header, /oauth_signature="[^" ]+"/);
});
test('GitHub state reservation has no overwrite SHA, completion uses the exact reservation SHA', async () => {
  const bodies = [];
  const state = githubState({ repository: 'owner/repo', token: 'example', request: async (_url, options) => {
    if (!options.method) return new Response('', { status: 404 });
    bodies.push(JSON.parse(options.body)); return Response.json({ content: { sha: 'reservation' } });
  } });
  assert.equal(await state.read(sha), null);
  await state.reserve(sha, { status: 'pending' }); await state.finish(sha, { status: 'sent' });
  assert.equal(bodies[0].sha, undefined); assert.equal(bodies[1].sha, 'reservation');
  assert.ok(bodies.every(body => body.branch === 'automation-state'));
});
