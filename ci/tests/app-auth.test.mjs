import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { parse } from 'yaml';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const workflow = parse(await readFile(new URL('../../.github/workflows/github-app-auth-check.yml', import.meta.url), 'utf8'));
const script = workflow.jobs.authenticate.steps[0].with.script;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
async function exercise(failRead = false) {
  const calls = [], failures = [], secrets = [];
  const sha = 'a'.repeat(40);
  const github = { rest: { repos: { get: async () => ({ data: { id: 123 } }), getBranch: async () => ({ data: { commit: { sha } } }) } },
    request() { throw Error('Default Octokit must not handle App/installation authentication'); } };
  const summary = { addHeading() { return this; }, addTable() { return this; }, async write() {} };
  const core = { setSecret: secret => secrets.push(secret), setFailed: message => failures.push(message), info() {}, summary };
  const request = async (url, options) => {
    const path = new URL(url).pathname;
    calls.push([options.method, path]);
    assert.equal(options.redirect, 'error');
    const authorization = options.headers.Authorization;
    if (path === '/app' || path.includes('/installation') && path.startsWith('/repos/') || path.endsWith('/access_tokens')) {
      assert.match(authorization, /^Bearer /);
      const jwt = authorization.slice(7);
      assert.ok(secrets.includes(jwt));
      const [header, payload, signature] = jwt.split('.');
      assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')), true);
      assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).iss, '5403155');
    } else {
      assert.equal(authorization, 'Bearer test-installation-token');
      assert.ok(secrets.includes('test-installation-token'));
    }
    if (path === '/app') return Response.json({ id: 5403155, slug: 'pulbase-codex', owner: { login: 'papettoTV' },
      permissions: { contents: 'write', pull_requests: 'write', issues: 'write', checks: 'read', administration: 'read' } });
    if (path.endsWith('/installation')) return Response.json({ app_id: 5403155, id: 456, suspended_at: null });
    if (path.endsWith('/access_tokens')) {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.repository_ids, [123]);
      assert.ok(Object.values(body.permissions).every(permission => permission === 'read'));
      return Response.json({ token: 'test-installation-token' });
    }
    if (path === '/installation/repositories') {
      if (failRead) return new Response('', { status: 403 });
      return Response.json({ total_count: 1, repositories: [{ id: 123 }] });
    }
    if (path.includes('/branches/')) return Response.json({ commit: { sha } });
    if (options.method === 'DELETE' && path === '/installation/token') return new Response(null, { status: 204 });
    throw Error('Unexpected endpoint');
  };
  await new AsyncFunction('github', 'context', 'core', 'require', 'fetch', 'process', script)(github,
    { repo: { owner: 'papettoTV', repo: 'virtual_gamecenter' } }, core, createRequire(import.meta.url), request,
    { env: { APP_ID: '5403155', EXPECTED_BOT: 'pulbase-codex[bot]', APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs1', format: 'pem' }) } });
  return { calls, failures };
}
test('App check sends a signed JWT directly and revokes its read-only scoped token', async () => {
  const { calls, failures } = await exercise();
  assert.deepEqual(failures, []);
  assert.deepEqual(calls.at(-1), ['DELETE', '/installation/token']);
  assert.equal(calls.filter(([method]) => method === 'POST').length, 1);
  assert.ok(!calls.some(([method]) => method === 'PUT' || method === 'PATCH'));
});
test('App check revokes the token even when a repository read fails', async () => {
  const { calls, failures } = await exercise(true);
  assert.match(failures[0], /scoped repository access \(HTTP 403\)/);
  assert.deepEqual(calls.at(-1), ['DELETE', '/installation/token']);
});
