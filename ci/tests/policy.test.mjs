import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertChanges, allowedPath, assertReview, assertAutomatedPr, assertProductionApproval } from '../policy.mjs';
import { checkRevision } from '../check-revision.mjs';
import { checkWorkflows } from '../check-workflows.mjs';
const sha = 'a'.repeat(40);
test('アプリの認証・課金・バックエンドも編集でき、制御パスとrename迂回は拒否する', () => {
  const allowed = [
    'apps/web/src/features/platform/PlatformExperience.tsx',
    'apps/web/src/features/platform/use-credit-purchase.ts',
    'apps/web/src/features/analytics/AnalyticsConsent.tsx',
    'apps/web/src/worker/auth.ts', 'apps/web/src/worker/credit-reservations.ts',
    'apps/web/src/games/graze-duel/input.js', 'apps/web/src/games/graze-duel/legacy-runtime.js',
    'apps/web/src/shared/client.mjs', 'apps/web/src/shared/protocol.json',
    'apps/web/tests/platform/credit.test.ts', 'apps/web/tests/ui/auth.spec.mjs',
    'apps/web/public/analytics.js', 'apps/web/public/legal/privacy.html',
    'apps/web/public/brand/logo.svg', 'apps/web/index.html', 'docs/credit-platform-auth.md',
  ];
  assertChanges(allowed.map(filename => ({ filename })));
  for (const filename of [
    '.github/workflows/x.yml', 'ci/policy.mjs', 'tools/install.py',
    'apps/web/package.json', 'apps/web/package-lock.json', 'apps/web/.env',
    'apps/web/wrangler.jsonc', 'apps/web/pages/wrangler.jsonc',
    'apps/web/config/pages-targets.json', 'apps/web/scripts/release.mjs',
    'apps/web/src/pages/gateway.mjs', 'apps/web/src/pages/new-gateway.ts',
    'apps/web/migrations/0016_credit.sql', 'apps/web/vite.config.ts',
    'apps/web/src/games/dot-wave/duel/vitest.config.ts', 'apps/web/tests/vitest.config.ts',
    'apps/web/public/_worker.js', 'apps/web/public/_worker.js/index.js',
    'apps/web/public/_routes.json', 'apps/web/public/_redirects', 'apps/web/public/_headers',
    'apps/web/src/.agents/hook.ts', 'apps/web/tests/.codex/instructions.js',
    'docs/../AGENTS.md', 'docs/AGENTS.md', 'docs/SKILL.md', 'docs/CLAUDE.md', 'docs/GEMINI.md',
    'docs/nested/agents.md', 'docs/a b.md', '/docs/a.md', 'docs//a.md',
    'apps/web/src/games/../worker/index.ts', 'apps/web/src/worker/index.ts.bak',
    'AGENTS.md', 'README.md', 'apps/web/public/promo.mp4',
  ]) assert.equal(allowedPath(filename), false, filename);
  assert.throws(() => assertChanges([]));
  assert.throws(() => assertChanges(Array.from({length:61}, () => ({filename:'docs/a.md'}))));
  for (const previous_filename of ['ci/policy.mjs','apps/web/src/pages/gateway.mjs','apps/web/vite.config.ts']) {
    assert.throws(() => assertChanges([{filename:'apps/web/src/worker/index.js',previous_filename}]));
  }
  assert.throws(() => assertChanges([{filename:'ci/policy.mjs',previous_filename:'apps/web/src/worker/index.ts'}]));
});
test('review fails closed on malformed/negative findings', () => {
  assertReview({ pass: true, findings: [] });
  for (const value of [null, {}, { pass: 'true', findings: [] }, { pass: true, findings: ['bug'] }, { pass: false, findings: [] }]) assert.throws(() => assertReview(value));
});
test('merge eligibility checks author, branch, repository and head', () => {
  const options = { repository: 'owner/repo', bot: 'app[bot]' };
  const pr = { user: { login: 'app[bot]' }, base: { ref: 'develop', sha }, head: { ref: 'codex/issue-1', sha, repo: { full_name: 'owner/repo' } }, state: 'open', draft: false };
  assertAutomatedPr(pr, options);
  for (const bad of [{ ...pr, user: { login: 'someone' } }, { ...pr, base: { ref: 'main', sha } }, { ...pr, draft: true },
    { ...pr, head: { ...pr.head, repo: { full_name: 'fork/repo' } } }]) assert.throws(() => assertAutomatedPr(bad, options));
});
test('production requires main, explicit enablement and full SHA', () => {
  assertProductionApproval({ ref: 'refs/heads/main', enabled: 'true', sha });
  for (const value of [{ ref: 'refs/heads/develop', enabled: 'true', sha }, { ref: 'refs/heads/main', enabled: 'false', sha }, { ref: 'refs/heads/main', enabled: 'true', sha: 'abc' }]) assert.throws(() => assertProductionApproval(value));
});
test('deployed revision requires both Worker and Pages, and does not follow redirects', async () => {
  for (const [worker, gateway, status, ok] of [[sha, sha, 200, true], [sha, 'b'.repeat(40), 200, false], ['', '', 200, false], [sha, sha, 302, false]]) {
    const request = async (url, options) => {
      assert.equal(options.redirect, 'manual');
      assert.ok(url.startsWith('https://develop.virtual-gamecenter.pages.dev/'));
      return new Response('', { status, headers: { 'X-Pulbase-Revision': worker, 'X-Pulbase-Gateway-Revision': gateway } });
    };
    const action = checkRevision({ environment: 'staging', sha }, request);
    if (ok) assert.equal((await action).ok, true); else await assert.rejects(action);
  }
  await assert.rejects(checkRevision({ environment: 'production', sha }, () => { throw Error('must not call'); }));
});
test('workflow dependencies, production isolation and Codex privilege boundaries', async () => { assert.ok(await checkWorkflows() >= 4); });
test('Pages preflight rejects Git deployment races and wrong production branch', async () => {
  const { assertPagesPipeline } = await import('../check-pages.mjs');
  const project = { production_branch: 'main', source: { config: { preview_deployment_setting: 'none', production_deployments_enabled: true } } };
  assertPagesPipeline(project, 'staging');
  assert.throws(() => assertPagesPipeline(project, 'production'));
  project.source.config.production_deployments_enabled = false;
  assertPagesPipeline(project, 'production');
  project.source.config.preview_deployment_setting = 'all';
  assert.throws(() => assertPagesPipeline(project, 'staging'));
  assert.throws(() => assertPagesPipeline({ ...project, production_branch: 'develop' }, 'staging'));
});
