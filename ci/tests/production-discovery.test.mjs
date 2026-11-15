import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { candidateDiscoveryReader, checkRehearsalCandidate, discoverRelease } from '../production-candidate/discover.mjs';
import { digest } from '../production-candidate/evidence.mjs';

const repo = 'papettoTV/virtual_gamecenter';
const now = Date.parse('2026-11-15T07:00:00Z');
const target = 'a'.repeat(40), main = 'b'.repeat(40), control = 'c'.repeat(40);
const ciPath = 'actions/workflows/web-checks.yml/runs?branch=develop&head_sha=' + target + '&per_page=10';
const prepPath = 'actions/workflows/production-preparation.yml/runs?branch=develop&head_sha=' + target + '&per_page=10';
const stagePath = 'actions/workflows/postmerge-staging.yml/runs?branch=ci-control&per_page=30';
const releasePath = 'actions/workflows/production-approved-release.yml/runs?branch=ci-control&per_page=30';

function fixture() {
  const run = (id, workflow, branch, sha, event, start, finish) => ({
    id, path: '.github/workflows/' + workflow + '.yml', head_branch: branch, head_sha: sha, head_repository: {full_name: repo},
    event, run_attempt: 1, status: 'completed', conclusion: 'success', created_at: new Date(now + start).toISOString(),
    updated_at: new Date(now + finish).toISOString(),
  });
  const ci = run(10, 'web-checks', 'develop', target, 'push', -10000, -8000);
  const prep = run(20, 'production-preparation', 'develop', target, 'push', -10000, -1000);
  const stage = run(30, 'postmerge-staging', 'ci-control', control, 'workflow_dispatch', -7000, -2000);
  const record = {status: 'passed', mode: 'postmerge-staging-live', sha: target, ciRunId: '10', controlSha: control,
    protectionMode: 'strict', protectionVerified: true, publicationCount: 1, regressionCount: 1, browserTests: 8,
    workerOutcome: 'uploaded', regressionPassed: true, httpAttempted: true, browserAttempted: true,
    realDeploymentExecuted: true, realRegressionExecuted: true, mainUpdated: false, productionRequested: false,
    executionMode: 'live', httpSimulated: false, browserSimulated: false, publication: 'worker', pagesOutcome: 'not-attempted', approvalCount: 0};
  const list = (...workflow_runs) => ({total_count: workflow_runs.length, workflow_runs});
  const data = {'git/ref/heads/develop':{object:{sha:target}}, 'git/ref/heads/main':{object:{sha:main}},
    'git/ref/heads/ci-control':{object:{sha:control}}, [ciPath]:list(ci), [prepPath]:list(prep),
    [stagePath]:list(stage), [releasePath]:list()};
  const bytes = () => Buffer.from(JSON.stringify(record));
  const artifacts = () => ({total_count:1, artifacts:[{id:41,name:'postmerge-result-30-1',expired:false,
    size_in_bytes:bytes().length,digest:'sha256:'+digest(bytes()),workflow_run:{id:30,head_sha:control,head_branch:'ci-control'}}]});
  const calls = [];
  const options = { controlSha: control, now, api: async path => {
    calls.push(path);
    if (path === 'actions/runs/30/artifacts?per_page=100') return artifacts();
    assert.ok(Object.hasOwn(data,path),path);
    return data[path];
  }, load: async value => { assert.equal(value,'41'); return bytes(); }, parse: async value => JSON.parse(value.toString()) };
  return {data, record, ci, prep, stage, options, calls};
}

test('同一SHAの初回CIと検証が揃うと操作なしで候補を選べる', async () => {
  const result = await discoverRelease(fixture().options);
  assert.deepEqual(result,{sha:target, mainSha:main, controlSha:control, ciRunId:10, preparationRunId:20, stagingRunId:30});
});

test('失敗・実行中・再実行・別SHA・既に起動済みの公開候補は選ばない', async () => {
  for (const change of [
    f => { f.ci.conclusion = 'failure'; },
    f => { f.prep.status = 'in_progress'; },
    f => { f.prep.run_attempt = 2; },
    f => { f.stage.head_sha = main; },
    f => { f.record.sha = main; },
    f => { f.data[releasePath] = {total_count:1,workflow_runs:[{head_repository:{full_name:repo},head_branch:'ci-control',display_title:'本番候補 '+target,status:'waiting'}]}; },
    f => { f.data['git/ref/heads/main'].object.sha=target; },
  ]) {
    const f=fixture(); change(f);
    assert.equal(await discoverRelease(f.options),null);
  }
});

test('検証が模擬、保護が不一致、成果物が差し替わった場合は停止する', async () => {
  for (const change of [
    f => { f.record.realRegressionExecuted=false; },
    f => { f.record.protectionMode='construction'; },
    f => { f.options.load=async () => Buffer.from('changed'); },
    f => { f.options.controlSha=main; },
  ]) {
    const f=fixture(); change(f);
    await assert.rejects(discoverRelease(f.options));
  }
});

test('照合後にdevelopが進んだ場合は起動対象を返さない', async () => {
  const f=fixture(), read=f.options.api; let count=0;
  f.options.api=async path => path==='git/ref/heads/develop' && ++count===2 ? {object:{sha:main}} : read(path);
  assert.equal(await discoverRelease(f.options),null);
});

test('候補探索はGET限定、起動は制御ブランチだけで登録版に公開権限はない', async () => {
  const requests=[];
  const reader=candidateDiscoveryReader(args => {requests.push(args); return Buffer.from('{}');});
  await reader.api(ciPath);
  await assert.rejects(reader.api('actions/workflows/production-approved-release.yml/dispatches'));
  assert.deepEqual(requests[0].slice(0,3),['api','--method','GET']);
  const read = async file => parse(await readFile(new URL('../../.github/workflows/'+file,import.meta.url),'utf8'));
  const kickoff = await read('production-approved-dispatch.yml');
  const registration = await read('production-approved-release.yml');
  assert.equal(kickoff.on.workflow_dispatch,undefined);
  assert.equal(kickoff.jobs.discover.permissions.actions,'read');
  assert.equal(kickoff.jobs.dispatch.permissions.actions,'write');
  assert.match(kickoff.jobs.dispatch.steps[0].run,/ref: 'ci-control'/);
  assert.deepEqual(registration.permissions,{});
  assert.equal(registration.jobs['registration-only'].environment,undefined);
});

test('鍵なし予行試験では自分のrunだけを除外し、承認対象の変更と再実行を拒否する', async () => {
  const f = fixture();
  f.data[releasePath] = {total_count:1, workflow_runs:[{id:50,head_repository:{full_name:repo},head_branch:'ci-control',display_title:'本番候補 '+target}]};
  const context = {
    GITHUB_REPOSITORY:repo, GITHUB_REF:'refs/heads/ci-control', GITHUB_RUN_ATTEMPT:'1',
    GITHUB_EVENT_NAME:'workflow_dispatch', GITHUB_RUN_ID:'50', GITHUB_SHA:control,
    PULBASE_EXPECTED_CONTROL_SHA:control, INPUT_SHA:target, INPUT_MAIN_SHA:main,
    INPUT_CI_RUN_ID:'10', INPUT_STAGING_RUN_ID:'30', INPUT_PREPARATION_RUN_ID:'20',
  };
  const plan = await checkRehearsalCandidate(f.options,context);
  assert.equal(plan.mainUpdated,false);
  assert.equal(plan.deploymentRequested,false);
  assert.deepEqual(await checkRehearsalCandidate(f.options,{...context,RELEASE_PLAN_FINGERPRINT:plan.fingerprint}),plan);
  for (const replace of [{INPUT_CI_RUN_ID:'11'},{GITHUB_RUN_ATTEMPT:'2'},
                        {RELEASE_PLAN_FINGERPRINT:'changed'},{GITHUB_REF:'refs/heads/develop'}]) {
    await assert.rejects(checkRehearsalCandidate(f.options,{...context,...replace}));
  }
});

test('予行試験の承認は1ジョブで、固定SHAの再照合に書込やSecretを付けない', async () => {
  const workflow = parse(await readFile(new URL('../../.github/workflow-templates/production-approved-release.yml.disabled',import.meta.url),'utf8'));
  assert.deepEqual(workflow.permissions,{ contents:'read', actions:'read' });
  assert.match(workflow.jobs.prepare.if,/PULBASE_PRODUCTION_ENABLED == 'false'/);
  assert.equal(Object.values(workflow.jobs).filter(job => job.environment).length,1);
  assert.equal(workflow.jobs.rehearse.environment,'production-rehearsal');
  assert.match(workflow.jobs.prepare.steps.at(-1).run,/handoff\.mjs --prepare$/);
  assert.match(workflow.jobs.rehearse.steps.at(-1).run,/handoff\.mjs --after-approval$/);
  assert.match(workflow.jobs.rehearse.steps.at(-1).env.RELEASE_BUNDLE_FINGERPRINT,/needs\.prepare\.outputs\.fingerprint/);
  assert.doesNotMatch(JSON.stringify(workflow),/secrets\./);
});
