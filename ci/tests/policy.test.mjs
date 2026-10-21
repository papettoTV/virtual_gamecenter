import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertChanges, allowedPath, assertReview, assertAutomatedPr, assertProductionApproval } from '../policy.mjs';
import { checkRevision } from '../check-revision.mjs';
import { checkWorkflows } from '../check-workflows.mjs';
const sha = 'a'.repeat(40);
test('automation allows UI changes and rejects infrastructure, security, path tricks and renames', () => {
  assertChanges([{ filename: 'apps/web/src/games/dot-wave/game.ts' }, { filename: 'apps/web/tests/game.test.mjs' }]);
  assertChanges([{ filename: 'apps/web/src/games/graze-duel/rendering/canvas-renderer.js' },
    { filename: 'apps/web/src/games/graze-duel/rendering/game-over-overlay.js' }, { filename: 'docs/pc-play-spectating-verification.md' }]);
  for (const filename of ['.github/workflows/x.yml', 'ci/policy.mjs', 'apps/web/package.json', 'apps/web/src/worker/index.ts',
    'apps/web/src/features/platform/PlatformExperience.tsx', 'docs/../AGENTS.md', 'docs/AGENTS.md', 'docs/a b.md', '/docs/a.md', 'docs//a.md',
    'apps/web/src/games/graze-duel/game.js', 'apps/web/src/shared/rendering/client.js', 'apps/web/src/worker/rendering/renderer.js',
    'apps/web/src/games/graze-duel/rendering/auth.js', 'apps/web/src/games/graze-duel/rendering/../game.js',
    'apps/web/src/games/graze-duel/rendering/config.json', 'docs/SKILL.md', 'docs/CLAUDE.md', 'docs/GEMINI.md', 'docs/agents.md',
    'AGENTS.md', 'README.md', 'apps/web/src/games/graze-duel/rendering/README.md']) {
    assert.equal(allowedPath(filename), false, filename);
  }
  assert.throws(() => assertChanges([]));
  assert.throws(() => assertChanges([{ filename: 'docs/a.md', previous_filename: 'ci/policy.mjs' }]));
  assert.throws(() => assertChanges([{ filename: 'apps/web/src/games/graze-duel/rendering/a.js', previous_filename: 'apps/web/src/worker/index.js' }]));
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
