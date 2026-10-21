import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ciEvidence, waitForCi, assertCurrentTarget, githubApi } from '../ci-evidence.mjs';
const sha = 'a'.repeat(40), merge = 'b'.repeat(40), base = 'c'.repeat(40), repository = 'papettoTV/virtual_gamecenter';
function fixture(event = 'push') {
  const run = { id: 12, run_attempt: 1, head_sha: sha, event, status: 'completed', conclusion: 'success', path: '.github/workflows/web-checks.yml', head_repository: { full_name: repository }, head_branch: 'develop' };
  const artifact = { id: 23, name: `staging-build-${merge}-1`, size_in_bytes: 1000, expired: false, workflow_run: { id: 12, head_sha: sha } };
  const jobs = ['verify', 'Automation control checks'].map(name => ({ name, status: 'completed', conclusion: 'success' }));
  const api = async path => path.startsWith('actions/workflows/') ? { workflow_runs: [run] } : path.includes('/jobs?') ? { jobs } : { artifacts: [artifact] };
  return { run, jobs, artifact, options: { api, repository, checkSha: sha, buildSha: merge, event } };
}
test('CI成功と正確なビルドSHA・run・attemptの成果物だけを採用する', async () => {
  const f = fixture('pull_request');
  assert.deepEqual(await ciEvidence(f.options), { runId: '12', attempt: '1', artifactId: '23' });
  for (const change of [{ conclusion: 'failure' }, { path: '.github/workflows/other.yml' }, { head_repository: { full_name: 'fork/repo' } }]) {
    const g = fixture(); Object.assign(g.run, change); await assert.rejects(ciEvidence(g.options));
  }
  for (const change of [{ name: `staging-build-${sha}-1` }, { expired: true }, { workflow_run: { id: 99, head_sha: sha } }, { size_in_bytes: 300 * 1024 * 1024 }]) {
    const g = fixture(); Object.assign(g.artifact, change); await assert.rejects(ciEvidence(g.options));
  }
});
test('一部チェックの失敗・スキップや古い成功runへのフォールバックを許可しない', async () => {
  for (const conclusion of ['failure', 'skipped', 'cancelled']) {
    const f = fixture(); f.jobs[1].conclusion = conclusion; await assert.rejects(ciEvidence(f.options));
  }
  const f = fixture();
  const original = f.options.api;
  f.options.api = async path => path.startsWith('actions/workflows/') ? { workflow_runs: [f.run, { ...f.run, id: 13, conclusion: 'failure' }] } : original(path);
  await assert.rejects(ciEvidence(f.options));
  await assert.rejects(ciEvidence({ ...fixture().options, runId: '99' }));
});
test('進行中だけ期限付きで待ち、未成功のまま公開しない', async () => {
  const f = fixture(); f.run.status = 'in_progress'; let waits = 0;
  await assert.rejects(waitForCi(f.options, { attempts: 2, wait: async () => { waits++; } }), /timed out/);
  assert.equal(waits, 1);
  f.run.status = 'completed';
  assert.equal((await waitForCi(f.options, { attempts: 1 })).runId, '12');
});
test('公開直前のdevelop・PRの変更や手元への切替を拒否する', async () => {
  const pr = { state: 'open', draft: false, base: { ref: 'develop', sha: base }, head: { sha, ref: 'codex/issue-1', repo: { full_name: repository } } };
  let branch = base, labels = ['実装:自動'];
  const api = async path => path.startsWith('git/') ? { object: { sha: branch } } : path.startsWith('pulls/') ? pr : { state: 'open', labels };
  await assertCurrentTarget({ api, expectedBase: base, checkSha: sha, pullNumber: 2 });
  branch = sha; await assert.rejects(assertCurrentTarget({ api, expectedBase: base, checkSha: sha, pullNumber: 2 }));
  branch = base; pr.head.sha = merge; await assert.rejects(assertCurrentTarget({ api, expectedBase: base, checkSha: sha, pullNumber: 2 }));
  pr.head.sha = sha; labels = []; await assert.rejects(assertCurrentTarget({ api, expectedBase: base, checkSha: sha, pullNumber: 2 }));
  branch = sha; await assertCurrentTarget({ api, expectedBase: sha, checkSha: sha });
});
test('CI確認は固定GitHub repoへのGETだけで、API失敗時に応答を漏らさない', async () => {
  const api = githubApi(repository, 'example', async (url, options) => {
    assert.ok(url.startsWith(`https://api.github.com/repos/${repository}/`));
    assert.equal(options.method, undefined); assert.equal(options.redirect, 'error');
    return new Response('sensitive response', { status: 403 });
  });
  await assert.rejects(api('actions/workflows/web-checks.yml/runs'), error => !error.message.includes('sensitive'));
  assert.throws(() => githubApi('other/repo', 'example'));
});
