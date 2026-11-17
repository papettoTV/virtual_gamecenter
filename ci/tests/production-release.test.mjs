import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { packProductionBundle } from '../production-candidate/build-bundle.mjs';
import { pagesUploadConfigHash, prepareProductionPublication } from '../production-candidate/publication.mjs';
import { ProductionPromotionRejected, runApprovedProductionRelease } from '../production-candidate/release.mjs';
import { productionCloudflare } from '../production-candidate/cloudflare-release.mjs';
import { checkPublicProductionBrowser, checkPublicProductionHttp } from '../production-candidate/public-regression.mjs';
import { wranglerPublicationIdentifier } from '../production-candidate/public-wrangler.mjs';
import { verifyUnchangedProductionMigrations } from '../production-candidate/production-operations.mjs';
import { productionGitHub } from '../production-candidate/github-release.mjs';
import { verifyProtection } from '../control/protection-check.mjs';

const repo = 'papettoTV/virtual_gamecenter';
const mainSha = 'a'.repeat(40);
const revision = 'b'.repeat(40);
const controlSha = 'c'.repeat(40);
const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const before = { worker: { deploymentId: id(1), versionId: id(2) },
  pages: { deploymentId: id(3), revision: mainSha } };
const after = { worker: { deploymentId: id(4), versionId: id(5) },
  pages: { deploymentId: id(6), revision } };

function project(page) {
  return { name: 'virtual-gamecenter', production_branch: 'main', domains: ['pulbase.com'],
    source: { config: { production_deployments_enabled: false, preview_deployment_setting: 'none' } },
    build_config: { destination_dir: 'apps/web/dist/client' },
    canonical_deployment: { id: page.deploymentId, environment: 'production', latest_stage: { status: 'success' },
      deployment_trigger: { metadata: { commit_hash: page.revision } } } };
}

async function fixture(t) {
  const scratch = await mkdtemp(join(tmpdir(), 'production-release-test-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const webRoot = join(scratch, 'web');
  const gateway = await readFile(new URL('../control/staging-gateway.mjs', import.meta.url), 'utf8');
  for (const [path, bytes] of Object.entries({
    'dist/client/_worker.js': gateway.replace('__PULBASE_GATEWAY_REVISION__', revision),
    'dist/client/_routes.json': '{}', 'dist/virtual_gamecenter/index.js': revision,
    'migrations/0001_test.sql': 'SELECT 1;',
  })) {
    const dest = join(webRoot, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
  }
  const directory = join(scratch, 'bundle');
  const scope = { revision, tree: 'd'.repeat(40), run: '42', attempt: '1' };
  const bundle = await packProductionBundle({ webRoot, directory, ...scope });
  const plan = await prepareProductionPublication(directory, { ...scope, expectedDigest: bundle.manifestDigest }, scratch);
  const context = { repository: repo, ref: 'refs/heads/ci-control', event: 'workflow_dispatch',
    attempt: '1', runId: '24', controlSha };
  const apiData = {
    'actions/runs/24': { id: 24, head_sha: controlSha, head_repository: { full_name: repo }, head_branch: 'ci-control',
      path: '.github/workflows/production-approved-release.yml', event: 'workflow_dispatch', run_attempt: 1, status: 'in_progress' },
    'environments/production': { id: 17, name: 'production', can_admins_bypass: false,
      deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
      protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { login: 'papettoTV' } }] }] },
    'environments/production/deployment-branch-policies?per_page=100': { total_count: 1,
      branch_policies: [{ type: 'branch', name: 'ci-control' }] },
    'actions/runs/24/approvals': [{ state: 'approved', user: { login: 'papettoTV' }, environments: [{ id: 17, name: 'production' }] }],
    'git/ref/heads/ci-control': { object: { sha: controlSha } },
  };
  const calls = [];
  const state = structuredClone(before);
  let ref = mainSha;
  const github = { api: async path => apiData[path], guard: async () => {}, preflight: async () => {},
    main: async () => ref, promote: async sha => { calls.push('main'); ref = sha; } };
  const cloudflare = { current: async () => structuredClone(state), project: async () => project(state.pages),
    execute: async target => {
      calls.push(target);
      state[target] = structuredClone(after[target]);
      return target === 'worker' ? state.worker.versionId : state.pages.deploymentId;
    },
    rollback: async (target, previous) => {
      calls.push('restore-' + target);
      state[target] = { ...previous, ...(target === 'worker' ? { deploymentId: id(7) } : {}) };
    },
  };
  const regression = { http: async sha => calls.push(sha === mainSha ? 'old-http' : 'http'),
    browser: async () => { calls.push('browser'); return 8; } };
  return { options: { candidate: { sha: revision, mainSha }, plan, context, github, cloudflare, regression }, calls, state, apiData };
}

test('本番承認1回後にWorker・Pages・HTTP・ブラウザを実施し、成功後だけmainを昇格する', async t => {
  const f = await fixture(t);
  const result = await runApprovedProductionRelease(f.options);
  assert.equal(result.success, true);
  assert.deepEqual(f.calls, ['old-http', 'worker', 'pages', 'http', 'browser', 'main']);
});

test('本番承認がない場合は公開もmain更新も行わない', async t => {
  const f = await fixture(t);
  f.apiData['actions/runs/24/approvals'] = [];
  assert.equal((await runApprovedProductionRelease(f.options)).phase, 'approval');
  assert.deepEqual(f.calls, []);
});

test('回帰失敗時はPagesとWorkerを前の配信に戻してHTTPを再確認する', async t => {
  const f = await fixture(t);
  f.options.regression.browser = async () => 7;
  const result = await runApprovedProductionRelease(f.options);
  assert.equal(result.success, false);
  assert.deepEqual(result.rollback, { status: 'verified', pages: true, worker: true });
  assert.deepEqual(f.calls, ['old-http', 'worker', 'pages', 'http', 'restore-pages', 'restore-worker', 'old-http']);
});

test('公開応答が不明で新しい配信を特定できない場合は切り戻しを要求しない', async t => {
  const f = await fixture(t);
  const execute = f.options.cloudflare.execute;
  f.options.cloudflare.execute = async target => { await execute(target); throw Error('response lost'); };
  const result = await runApprovedProductionRelease(f.options);
  assert.equal(result.rollback.status, 'needs-attention');
  assert.deepEqual(f.calls, ['old-http', 'worker']);
});

test('Pages公開前の失敗は今回のWorkerだけを戻して旧配信を確認する', async t => {
  const f = await fixture(t);
  const execute = f.options.cloudflare.execute;
  f.options.cloudflare.execute = async (target, ...args) => {
    if (target === 'pages') throw Error('Pages upload rejected');
    return execute(target, ...args);
  };
  const result = await runApprovedProductionRelease(f.options);
  assert.equal(result.success, false);
  assert.equal(result.phase, 'pages');
  assert.deepEqual(result.rollback, { status: 'verified', pages: false, worker: true });
  assert.deepEqual(f.calls, ['old-http', 'worker', 'restore-worker', 'old-http']);
});

test('回帰の途中で別のPages配信が見つかったら両方の切り戻しを止める', async t => {
  const f = await fixture(t);
  f.options.regression.browser = async () => {
    f.state.pages = { ...f.state.pages, deploymentId: id(99) };
    throw Error('browser regression failed');
  };
  const result = await runApprovedProductionRelease(f.options);
  assert.equal(result.success, false);
  assert.deepEqual(result.rollback, { status: 'needs-attention', pages: false, worker: false });
  assert.ok(!f.calls.some(call => call.startsWith('restore-') || call === 'main'));
});

test('main更新応答が不明でも実refが候補SHAなら切り戻さない', async t => {
  const f = await fixture(t);
  const promote = f.options.github.promote;
  f.options.github.promote = async sha => { await promote(sha); throw Error('response lost'); };
  assert.equal((await runApprovedProductionRelease(f.options)).success, true);
  assert.equal(f.calls.at(-1), 'main');
});

test('明確なmain更新拒否では公開だけを切り戻し、mainへforce pushしない', async t => {
  const f = await fixture(t);
  f.options.github.promote = async () => { throw new ProductionPromotionRejected('ruleset rejected'); };
  const result = await runApprovedProductionRelease(f.options);
  assert.equal(result.mainUpdated, false);
  assert.equal(result.rollback.status, 'verified');
  assert.deepEqual(f.calls.slice(-3), ['restore-pages', 'restore-worker', 'old-http']);
});

test('main書込の成否が不明で現在値が旧SHAのときは、公開の切り戻しを待つ', async t => {
  const f = await fixture(t);
  f.options.github.promote = async () => { throw Error('response lost'); };
  const result = await runApprovedProductionRelease(f.options);
  assert.equal(result.success, false);
  assert.equal(result.rollback.status, 'needs-attention');
  assert.ok(!f.calls.some(call => call.startsWith('restore-')));
});

test('D1移行の差分または不完全なGitツリーでは公開へ進まない', async () => {
  const tree = sha => ({ truncated: false, tree: [{ path: 'apps/web/migrations', type: 'tree', sha }] });
  await verifyUnchangedProductionMigrations(async () => tree(mainSha), mainSha, revision);
  await assert.rejects(verifyUnchangedProductionMigrations(async path =>
    tree(path.includes(mainSha) ? mainSha : revision), mainSha, revision), /D1移行/);
  await assert.rejects(verifyUnchangedProductionMigrations(async () =>
    ({ ...tree(mainSha), truncated: true }), mainSha, revision), /移行定義/);
});

test('固定Wranglerの成功出力から今回の識別子だけを取得する', () => {
  assert.equal(wranglerPublicationIdentifier('worker', 'Current Version ID: ' + id(5)), id(5));
  const url = 'https://f1e2f3e4.virtual-gamecenter.pages.dev';
  assert.equal(wranglerPublicationIdentifier('pages', '✨ Deployment complete! Take a peek over at ' + url + '\n'), url);
  assert.throws(() => wranglerPublicationIdentifier('pages', 'Deployment complete! Take a peek over at https://other.pages.dev'));
  assert.throws(() => wranglerPublicationIdentifier('worker', 'Current Version ID: ' + id(5) + '\nCurrent Version ID: ' + id(6)));
});

test('本番Appだけをmain更新ルールに限定し、fast-forward後に一時トークンを失効する', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = '2026-11-15T07:21:29.925Z';
  const oldRule = (branch, rules, bypass_actors = []) => ({ target: 'branch', enforcement: 'active', updated_at: now,
    conditions: { ref_name: { include: ['refs/heads/' + branch], exclude: [] } }, rules, bypass_actors });
  const update = oldRule('main', [{ type: 'update' }], [{ actor_id: 5405029, actor_type: 'Integration', bypass_mode: 'always' }]);
  const rules = {
    '25676153': oldRule('ci-control', ['creation', 'deletion', 'non_fast_forward', 'update'].map(type => ({ type }))),
    '25520943': update,
    '25520941': oldRule('main', [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'required_status_checks',
      parameters: { strict_required_status_checks_policy: true, do_not_enforce_on_create: false,
        required_status_checks: ['verify', 'Automation control checks'].map(context => ({ context, integration_id: 15368 })) } }]),
  };
  const candidate = { mainSha, sha: revision, controlSha };
  const mutations = [];
  const response = value => new Response(JSON.stringify(value));
  const api = productionGitHub({ context: { controlSha }, expectedControlSha: controlSha,
    versions: { ciControl: now, mainUpdate: now, mainIntegrity: now }, readToken: 'read', appKey: privateKey,
    request: async (url, options) => {
      const path = new URL(url).pathname;
      if (options.method !== 'GET') mutations.push([options.method, path, options.body && JSON.parse(options.body)]);
      if (path.includes('/rulesets/')) return response(rules[path.split('/').at(-1)]);
      if (path.endsWith('/git/ref/heads/develop')) return response({ object: { sha: revision } });
      if (path.includes('/compare/')) return response({ status: 'ahead', merge_base_commit: { sha: mainSha } });
      if (path === '/app') return response({ id: 5405029, slug: 'pulbase-release', owner: { login: 'papettoTV' } });
      if (path.endsWith('/installation')) return response({ app_id: 5405029, id: 64 });
      if (path.endsWith('/access_tokens')) return response({ token: 'installation',
        permissions: { contents: 'write', workflows: 'write', metadata: 'read' } });
      if (path === '/installation/repositories') return response({ total_count: 1, repositories: [{ full_name: repo }] });
      if (path === '/installation/token') return new Response(null, { status: 204 });
      if (path.endsWith('/git/refs/heads/main')) {
        assert.equal(options.headers.Authorization, 'Bearer installation');
        return response({ object: { sha: revision } });
      }
      throw Error('unexpected path');
    } });
  await api.guard(candidate);
  await api.preflight(candidate);
  await api.promote(revision);
  assert.deepEqual(mutations.filter(([method]) => method === 'PATCH'),
    [['PATCH', '/repos/' + repo + '/git/refs/heads/main', { sha: revision, force: false }]]);
  assert.equal(mutations.filter(([method]) => method === 'DELETE').length, 2);
  update.bypass_actors = [];
  await assert.rejects(api.guard(candidate), /bypass/);
});

test('本番昇格後もstagingはstrictとmainの必須保護を確認する', async () => {
  const timestamp = '2026-11-15T23:14:03.974Z';
  const env = { can_admins_bypass: false, deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { login: 'papettoTV' } }] }] };
  const branches = { total_count: 1, branch_policies: [{ type: 'branch', name: 'ci-control' }] };
  const rule = (branch, rules, bypass_actors = []) => ({ target: 'branch', enforcement: 'active', updated_at: timestamp, bypass_actors, rules,
    conditions: { ref_name: { include: ['refs/heads/' + branch], exclude: [] } } });
  const integrity = rule('main', [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'required_status_checks',
    parameters: { strict_required_status_checks_policy: true, do_not_enforce_on_create: false,
      required_status_checks: ['verify', 'Automation control checks'].map(context => ({ context, integration_id: 15368 })) } }]);
  const responses = { 'environments/staging': env, 'environments/staging/deployment-branch-policies?per_page=100': branches,
    'rulesets?per_page=100': [{ id: 25676153, name: 'ci-control-human-managed' }, { id: 25520943, name: 'main-release-app-only' }],
    'rulesets/25676153': rule('ci-control', ['creation', 'deletion', 'non_fast_forward', 'update'].map(type => ({ type }))),
    'rulesets/25520943': rule('main', [{ type: 'update' }], [{ actor_id: 5405029, actor_type: 'Integration', bypass_mode: 'always' }]),
    'rulesets/25520941': integrity, 'git/ref/heads/ci-control': { object: { sha: controlSha } },
    'git/ref/heads/main': { object: { sha: revision } }, 'git/ref/heads/develop': { object: { sha: revision } } };
  const api = async path => responses[path] ?? { status: 'ahead', merge_base_commit: { sha: path.slice(8, 48) } };
  const options = { ruleVersions: JSON.stringify({ ciControl: timestamp, main: timestamp, mainIntegrity: timestamp, protectionMode: 'strict' }) };
  const result = await verifyProtection(api, { controlSha }, options);
  assert.equal(result.mainSha, revision);
  assert.equal(result.protectionMode, 'strict');
  const prepare = await verifyProtection(api, { controlSha }, { requireSnapshot: false });
  assert.equal(prepare.preflightReady, true);
  assert.equal(prepare.protectionVerified, false);
  await assert.rejects(verifyProtection(api, { controlSha }, { ruleVersions: JSON.stringify({
    ciControl: timestamp, main: timestamp, protectionMode: 'strict',
  }) }), /例外/);
  integrity.bypass_actors = responses['rulesets/25520943'].bypass_actors;
  await assert.rejects(verifyProtection(api, { controlSha }, options), /必須CI/);
});

test('Cloudflare切り戻しは既知のPages IDとWorkerバージョンだけに別々のトークンを使う', async () => {
  const posts = [];
  const response = result => new Response(JSON.stringify({ success: true, result }));
  const transport = productionCloudflare({ workerToken: 'test-worker', pagesToken: 'test-pages',
    execute: async () => {}, request: async (url, options) => {
      const isWorker = url.includes('/workers/');
      assert.equal(options.headers.Authorization, isWorker ? 'Bearer test-worker' : 'Bearer test-pages');
      if (options.method === 'POST') { posts.push([new URL(url).pathname, options.body]); return response({ id: id(8) }); }
      if (url.endsWith('/subdomain')) return response({ enabled: false, previews_enabled: false });
      if (isWorker) return response({ deployments: [{ id: after.worker.deploymentId, created_on: '2026-11-15T00:00:00Z',
        versions: [{ percentage: 100, version_id: after.worker.versionId }] }] });
      return response(url.endsWith(before.pages.deploymentId) ? project(before.pages).canonical_deployment : project(after.pages));
    } });
  await transport.rollback('pages', before.pages, after.pages);
  await transport.rollback('worker', before.worker, after.worker);
  assert.ok(posts[0][0].endsWith('/deployments/' + before.pages.deploymentId + '/rollback'));
  assert.deepEqual(JSON.parse(posts[1][1]), { strategy: 'percentage', versions: [{ version_id: before.worker.versionId, percentage: 100 }] });
});

test('本番HTTPは公開URL・別名・運営者保護・SHAを確認し、ブラウザはサンドボックスで8件だけ実施する', async () => {
  const paths = [];
  const request = async url => {
    paths.push(url.pathname);
    return new Response(null, { status: url.hostname.endsWith('.pages.dev') || url.pathname.includes('operator') ? 401 : 200,
      headers: { 'www-authenticate': 'Basic realm="test"', 'x-pulbase-revision': revision, 'x-pulbase-gateway-revision': revision } });
  };
  await checkPublicProductionHttp(revision, request);
  assert.equal(paths.length, 10);
  await assert.rejects(checkPublicProductionHttp(revision, async () => new Response()));
  const result = await checkPublicProductionBrowser(revision, { command: async (tool, args, options) => {
    assert.equal(tool, 'playwright');
    assert.match(await readFile(args[2], 'utf8'), /chromiumSandbox: true/);
    assert.match(await readFile(join(options.cwd, 'production.spec.mjs'), 'utf8'), /wss:\/\/pulbase\.com/);
    assert.equal(options.env.GH_TOKEN, undefined);
    return { exitCode: 0, stdout: JSON.stringify({ errors: [], stats: { expected: 8, unexpected: 0, flaky: 0, skipped: 0 },
      suites: [{ specs: [{ tests: Array.from({ length: 8 }, () => ({})) }] }] }) };
  } });
  assert.equal(result, 8);
});

test('本番ブラウザ失敗は固定ケース・端末・分類・行だけを残し、公開を切り戻す', async t => {
  const f = await fixture(t);
  const message = 'Timeout: PRIVATE_BROWSER_VALUE at https://example.invalid/';
  const cases = ['home renders active games and versioned Worker/Pages', 'legal navigation /legal/terms',
    'legal navigation /legal/privacy', 'game navigation allows declining credit and returning before play'];
  const stdout = JSON.stringify({ errors: [], suites: [{ specs: cases.map((title, index) => ({
    title, tests: ['desktop', 'mobile'].map(projectName => ({
      projectName, results: index !== 3 || projectName === 'desktop'
        ? [{ status: 'passed', duration: 25 }]
        : [{ status: 'timedOut', duration: 5000, errors: [{ message,
          location: { file: '/private/work/production.spec.mjs', line: 42 } }],
          attachments: [{ path: message }] }],
    })),
  })) }] });
  f.options.regression.browser = revision => checkPublicProductionBrowser(revision, {
    command: async () => ({ exitCode: 1, stdout }),
  });
  const result = await runApprovedProductionRelease(f.options);
  assert.equal(result.success, false);
  assert.equal(result.failure.step, 'browser');
  assert.equal(result.rollback.status, 'verified');
  assert.equal(result.mainUpdated, false);
  assert.equal(result.browserFailure.kind, 'test-results');
  assert.deepEqual(result.browserFailure.cases.filter(item => item.status !== 'passed'), [{
    case: 'game-navigation', project: 'mobile', status: 'timedOut', durationMs: 5000,
    errors: [{ category: 'timeout', line: 42 }],
  }]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_BROWSER_VALUE|example\.invalid|\/private\/work/);
});

for (const scenario of ['pages-rate-limit', 'worker-privacy', 'pages-changed']) {
  test('鍵なし本番予行試験: ' + scenario, async t => {
    const f = await fixture(t);
    const { calls, state, options } = f;
    let checksAfterDeploy = 0;
    let pagesChecksAfterDeploy = 0;
    let rollbackStarted = false;
    let throttled = false;
    const response = result => new Response(JSON.stringify({ success: true, result }));
    options.cloudflare = productionCloudflare({
      workerToken: 'fake-worker', pagesToken: 'fake-pages', pause: async () => {},
      execute: async target => {
        calls.push(target);
        state[target] = structuredClone(after[target]);
        return target === 'worker' ? state.worker.versionId : 'https://abcdef12.virtual-gamecenter.pages.dev';
      },
      request: async (url, { method, body }) => {
        if (method === 'POST') {
          assert.match(url, /workers\/scripts\/pulbase-production\/deployments$/);
          assert.deepEqual(JSON.parse(body).versions, [{ version_id: before.worker.versionId, percentage: 100 }]);
          calls.push('restore-worker');
          rollbackStarted = true;
          state.worker = { ...before.worker, deploymentId: id(7) };
          return response({ id: id(7) });
        }
        assert.equal(method, 'GET');
        if (url.endsWith('/subdomain')) {
          if (state.worker.versionId === after.worker.versionId) checksAfterDeploy += 1;
          const blocked = scenario === 'worker-privacy' && checksAfterDeploy >= 2 && !rollbackStarted;
          return response({ enabled: false, previews_enabled: blocked });
        }
        if (url.includes('/workers/')) {
          const active = { id: state.worker.deploymentId, created_on: '2026-11-15T00:00:00Z',
            versions: [{ percentage: 100, version_id: state.worker.versionId }] };
          return response({ deployments: [active, { ...active, id: id(99), created_on: '2026-11-16T00:00:00Z' }] });
        }
        if (state.worker.versionId === after.worker.versionId) pagesChecksAfterDeploy += 1;
        if (scenario === 'pages-rate-limit' && pagesChecksAfterDeploy === 3 && !throttled) {
          throttled = true;
          return new Response('discarded', { status: 429 });
        }
        if (scenario === 'pages-changed' && pagesChecksAfterDeploy >= 3) {
          state.pages = { ...state.pages, deploymentId: id(99) };
        }
        const config = project(state.pages);
        config.canonical_deployment.url = 'https://abcdef12.virtual-gamecenter.pages.dev';
        return response(config);
      },
    });
    const report = await runApprovedProductionRelease(options);
    if (scenario === 'pages-rate-limit') {
      assert.equal(throttled, true);
      assert.equal(report.success, true);
      assert.deepEqual(calls, ['old-http', 'worker', 'pages', 'http', 'browser', 'main']);
    } else {
      assert.equal(report.success, false);
      assert.deepEqual(report.attempted, ['worker']);
      assert.equal(report.failure.step, 'before-pages');
      if (scenario === 'worker-privacy') {
        assert.deepEqual(report.failure, { step: 'before-pages', operation: 'worker-subdomain', reason: 'configuration' });
        assert.deepEqual(report.rollback, { status: 'verified', pages: false, worker: true });
        assert.deepEqual(calls, ['old-http', 'worker', 'restore-worker', 'old-http']);
      } else {
        assert.equal(report.rollback.status, 'needs-attention');
        assert.equal(report.rollbackFailure.reason, 'deployment-changed');
        assert.deepEqual(calls, ['old-http', 'worker']);
      }
    }
  });
}

test('切り戻しAPIの障害は再送せず、HTTPステータスだけを返す', async () => {
  let writes = 0;
  const transport = productionCloudflare({
    workerToken: 'fake-worker', pagesToken: 'fake-pages', execute: async () => {},
    request: async (_url, { method }) => {
      if (method === 'POST') {
        writes += 1;
        return new Response('non-public-response', { status: 503 });
      }
      return new Response(JSON.stringify({ success: true, result: { deployments: [{
        id: after.worker.deploymentId, versions: [{ percentage: 100, version_id: after.worker.versionId }],
      }] } }));
    },
  });
  await assert.rejects(transport.rollback('worker', before.worker, after.worker), error => {
    assert.deepEqual(error.diagnostic, { operation: 'worker-rollback', reason: 'http', status: 503 });
    assert.doesNotMatch(JSON.stringify(error), /non-public-response/);
    return true;
  });
  assert.equal(writes, 1);
});


test('鍵なし予行試験: Wranglerが送るSHA-256の変更だけなら本番回帰と昇格へ進む', async t => {
  const f = await fixture(t);
  const { cloudflare, plan } = f.options;
  const project = cloudflare.project;
  let configHash = 'c'.repeat(64);
  const beforeHash = configHash;
  cloudflare.project = async () => {
    const config = await project();
    config.deployment_configs = {
      production: { wrangler_config_hash: configHash, services: { BACKEND: { service: 'pulbase-production' } } },
      preview: { services: { BACKEND: { service: 'pulbase-staging' } } },
    };
    return config;
  };
  const execute = cloudflare.execute;
  cloudflare.execute = async (...args) => {
    const receipt = await execute(...args);
    if (args[0] === 'pages') {
      configHash = await pagesUploadConfigHash(plan);
      assert.notEqual(configHash, beforeHash);
    }
    return receipt;
  };
  const report = await runApprovedProductionRelease(f.options);
  assert.equal(report.success, true);
  assert.deepEqual(f.calls, ['old-http', 'worker', 'pages', 'http', 'browser', 'main']);
});

test('鍵なし予行試験: 切り戻しのAPIが旧配信を返すまで待ち、今回のハッシュが残っていても復元を確認する', async t => {
  const f = await fixture(t);
  const { cloudflare, plan } = f.options;
  const project = cloudflare.project;
  const current = cloudflare.current;
  const execute = cloudflare.execute;
  let configHash = 'c'.repeat(64);
  let restoreChecks = 0;
  let publishChecks = 0;
  let waited = 0;
  f.options.pause = async () => { waited += 1; };
  cloudflare.project = async () => {
    const config = await project();
    config.deployment_configs = { production: { wrangler_config_hash: configHash } };
    if (f.state.pages.revision === revision && ++publishChecks === 1) {
      config.canonical_deployment = { ...config.canonical_deployment, id: before.pages.deploymentId,
        deployment_trigger: { metadata: { commit_hash: mainSha } } };
    }
    return config;
  };
  cloudflare.current = async (...args) => {
    const state = await current(...args);
    if (f.calls.includes('restore-worker') && restoreChecks++ === 0) return structuredClone(after);
    return state;
  };
  cloudflare.execute = async (...args) => {
    const receipt = await execute(...args);
    if (args[0] === 'pages') configHash = await pagesUploadConfigHash(plan);
    return receipt;
  };
  f.options.regression.browser = async () => 7;
  const report = await runApprovedProductionRelease(f.options);
  assert.equal(report.failure.step, 'browser');
  assert.equal(waited, 2);
  assert.deepEqual(report.rollback, { status: 'verified', pages: true, worker: true });
  assert.deepEqual(f.calls, ['old-http', 'worker', 'pages', 'http', 'restore-pages', 'restore-worker', 'old-http']);
});

for (const change of ['other-hash', 'build-output', 'preview-binding']) {
  test('鍵なし予行試験: 実際の共有設定変更を昇格できない: ' + change, async t => {
    const f = await fixture(t);
    const { cloudflare, plan } = f.options;
    const project = cloudflare.project;
    cloudflare.project = async () => {
      const config = await project();
      config.deployment_configs = { production: { wrangler_config_hash: 'c'.repeat(64) },
        preview: { services: { BACKEND: { service: 'pulbase-staging' } } } };
      if (f.calls.includes('pages')) {
        config.deployment_configs.production.wrangler_config_hash =
          change === 'other-hash' ? 'd'.repeat(64) : await pagesUploadConfigHash(plan);
        if (change === 'build-output') config.build_config.destination_dir = 'different';
        if (change === 'preview-binding') config.deployment_configs.preview.services.BACKEND.service = 'different';
      }
      return config;
    };
    const report = await runApprovedProductionRelease(f.options);
    assert.equal(report.failure.step, 'pages-configuration');
    assert.deepEqual(report.rollback, { status: 'needs-attention', pages: true, worker: true });
    assert.equal(report.rollbackFailure.step, 'pages-configuration');
    assert.deepEqual(f.calls, ['old-http', 'worker', 'pages', 'restore-pages', 'restore-worker', 'old-http']);
  });
}
