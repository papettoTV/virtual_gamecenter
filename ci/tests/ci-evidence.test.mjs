import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ciEvidence, waitForCi, assertCurrentTarget, githubApi, ciEvidenceTimeoutMs, ciEvidenceFailure } from '../ci-evidence.mjs';
import {readFile} from 'node:fs/promises';
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
test('通常CIが10分を超えて成功しても、同じ候補の成果物まで待つ',async()=>{
 const f=fixture('pull_request'),api=f.options.api;let clock=0;
 f.options.api=async path=>{f.run.status=clock<14*60000?'in_progress':'completed';return api(path);};
 const result=await waitForCi(f.options,{now:()=>clock,wait:async ms=>{clock+=ms;}});
 assert.equal(clock,14*60000);assert.deepEqual(result,{runId:'12',attempt:'1',artifactId:'23'});
});
test('待機はAPI所要時間を含む期限で停止し、未完了やAPI失敗を成功にしない',async()=>{
 const f=fixture(),api=f.options.api;let clock=0,calls=0;
 f.run.status='in_progress';f.options.api=async path=>{clock+=7000;calls++;return api(path);};
 await assert.rejects(waitForCi(f.options,{timeoutMs:20000,now:()=>clock,wait:async ms=>{clock+=ms;}}),/timed out/);
 assert.equal(calls,2);assert.equal(clock,24000);
 const g=fixture();g.options.api=async()=>{throw Error('GitHub read failed');};
 await assert.rejects(waitForCi(g.options,{wait:async()=>assert.fail('API失敗を盲目的に再試行しない')}),/read failed/);
 for(const timeoutMs of [0,-1,NaN,Infinity])await assert.rejects(waitForCi(f.options,{timeoutMs}),/budget/);
});
test('CI・照合jobの上限は順序に合い、安全な固定コードで失敗理由を出す',async()=>{
 const web=await readFile(new URL('../../.github/workflows/web-checks.yml',import.meta.url),'utf8');
 const review=await readFile(new URL('../../.github/workflows/codex-pr.yml',import.meta.url),'utf8');
 const [,mobile,desktop]=web.match(/  ui:[\s\S]*?timeout-minutes: \$\{\{ matrix\.project == 'mobile' && (\d+) \|\| (\d+) \}\}/);
 const ui=Math.max(Number(mobile),Number(desktop));
 const verify=Number(web.match(/  verify:[\s\S]*?timeout-minutes: (\d+)/)[1]);
 const candidate=Number(review.match(/name: Candidate tests[\s\S]*?timeout-minutes: (\d+)/)[1]);
 assert.ok(ciEvidenceTimeoutMs>=(ui+verify+5)*60000);assert.ok(candidate*60000>=ciEvidenceTimeoutMs+5*60000);
 assert.deepEqual(ciEvidenceFailure(Error('CI evidence timed out')),{code:'ci-evidence-timeout'});
 assert.deepEqual(ciEvidenceFailure(Error('GitHub read failed')),{code:'ci-api-unavailable'});
 assert.deepEqual(ciEvidenceFailure(Error('secret body sk-private')),{code:'ci-evidence-unavailable'});
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
