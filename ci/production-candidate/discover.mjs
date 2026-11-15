// Select a candidate for the protected workflow. No deployment or approval permissions.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { readJsonArchive } from './check.mjs';
import { receipt } from './evidence.mjs';

const repository = 'papettoTV/virtual_gamecenter';
const sha = /^[a-f0-9]{40}$/;
const id = value => Number.isSafeInteger(value) && value > 0;
const heads = branch => 'git/ref/heads/' + branch;
const releaseWorkflow = 'production-approved-release.yml';
const maxAge = 24 * 60 * 60 * 1000;
const releaseRunTitle = revision => '本番候補 ' + revision;
const workflow = {
  ci: 'web-checks.yml',
  prep: 'production-preparation.yml',
  staging: 'postmerge-staging.yml',
};
const allowed = /^(?:git\/ref\/heads\/(?:develop|main|ci-control)|actions\/workflows\/(?:web-checks|production-preparation)\.yml\/runs\?branch=develop&head_sha=[a-f0-9]{40}&per_page=10|actions\/workflows\/(?:postmerge-staging|production-approved-release)\.yml\/runs\?branch=ci-control&per_page=30|actions\/runs\/[1-9][0-9]*(?:\/(?:artifacts\?per_page=100|jobs\?per_page=100))?)$/;

function currentRun(run, file, branch, revision, events, now) {
  const created = Date.parse(run.created_at), ended = Date.parse(run.updated_at);
  return id(run.id) && run.path === '.github/workflows/' + file
    && run.head_repository?.full_name === repository && run.head_branch === branch
    && run.head_sha === revision && events.includes(run.event)
    && run.run_attempt === 1 && run.status === 'completed' && run.conclusion === 'success'
    && Number.isFinite(created) && Number.isFinite(ended) && created <= ended
    && ended <= now + 30_000 && now - created <= maxAge;
}

function rows(payload, key) {
  if (!Array.isArray(payload?.[key]) || !Number.isSafeInteger(payload.total_count)
    || payload.total_count < payload[key].length) throw Error('GitHubの一覧が不正です。');
  return payload[key];
}

export function candidateDiscoveryReader(run = args => execFileSync('gh', args, {
  stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, maxBuffer: 4 * 1024 * 1024,
})) {
  const get = path => run(['api', '--method', 'GET', 'repos/' + repository + '/' + path]);
  return {
    api: async path => {
      if (!allowed.test(path)) throw Error('対象外の読取APIです。');
      return JSON.parse(get(path).toString());
    },
    load: async artifactId => {
      if (!/^[1-9][0-9]*$/.test(artifactId)) throw Error('成果物IDが不正です。');
      return get('actions/artifacts/' + artifactId + '/zip');
    },
  };
}

export async function discoverRelease({ api, load, parse = readJsonArchive, controlSha, releaseRunId, now = Date.now() }) {
  if (!sha.test(controlSha ?? '') || !Number.isSafeInteger(now)) throw Error('固定制御SHAが必要です。');
  const [develop, main, control] = await Promise.all(['develop', 'main', 'ci-control'].map(async branch =>
    (await api(heads(branch))).object?.sha));
  if (![develop, main, control].every(value => sha.test(value ?? '')) || control !== controlSha) {
    throw Error('ブランチまたは制御SHAが不一致です。');
  }
  if (main === develop) return null;
  const suffix = '/runs?branch=develop&head_sha=' + develop + '&per_page=10';
  const stagingPath = 'actions/workflows/' + workflow.staging + '/runs?branch=ci-control&per_page=30';
  const releasePath = 'actions/workflows/' + releaseWorkflow + '/runs?branch=ci-control&per_page=30';
  const [ciRuns, prepRuns, stagingRuns, releaseRuns] = await Promise.all([
    'actions/workflows/' + workflow.ci + suffix, 'actions/workflows/' + workflow.prep + suffix,
    stagingPath, releasePath,
  ].map(async path => rows(await api(path), 'workflow_runs')));
  if (releaseRuns.some(run => String(run.id) !== releaseRunId && run.head_repository?.full_name === repository
      && run.head_branch === 'ci-control' && run.display_title === releaseRunTitle(develop))) return null;
  const [ci] = ciRuns.filter(run => run.event === 'push').sort((a, b) => b.id - a.id);
  const [prep] = prepRuns.filter(run => ['push', 'workflow_dispatch'].includes(run.event)).sort((a, b) => b.id - a.id);
  if (!ci || !prep || !currentRun(ci, workflow.ci, 'develop', develop, ['push'], now)
      || !currentRun(prep, workflow.prep, 'develop', develop, ['push', 'workflow_dispatch'], now)) return null;

  const afterCI = stagingRuns.filter(run => Date.parse(run.created_at) >= Date.parse(ci.updated_at)
      && run.head_sha === controlSha && run.path === '.github/workflows/' + workflow.staging
      && run.event === 'workflow_dispatch').sort((a, b) => b.id - a.id);
  for (const stage of afterCI) {
    if (!currentRun(stage, workflow.staging, 'ci-control', controlSha, ['workflow_dispatch'], now)) continue;
    const bundle = await receipt(api, load, stage, 'postmerge-result', 'postmerge-result.json');
    const result = await parse(bundle.bytes, bundle.file);
    if (result.sha !== develop || result.ciRunId !== String(ci.id)) continue;
    if (result.status !== 'passed' || result.mode !== 'postmerge-staging-live' || result.controlSha !== controlSha
        || result.protectionMode !== 'strict' || result.protectionVerified !== true
        || result.publicationCount !== 1 || result.regressionCount !== 1 || result.browserTests !== 8
        || result.workerOutcome !== 'uploaded' || result.regressionPassed !== true
        || result.httpAttempted !== true || result.browserAttempted !== true
        || result.realDeploymentExecuted !== true || result.realRegressionExecuted !== true
        || result.executionMode !== 'live' || result.httpSimulated !== false || result.browserSimulated !== false
        || !((result.publication === 'worker' && result.pagesOutcome === 'not-attempted' && result.approvalCount === 0)
             || (result.publication === 'pages' && result.pagesOutcome === 'uploaded' && result.approvalCount === 1))
        || result.mainUpdated !== false || result.productionRequested !== false) {
      throw Error('検証公開・回帰の成功証跡が不完全です。');
    }
    const latestHeads = await Promise.all(['develop', 'main', 'ci-control'].map(async branch =>
      (await api(heads(branch))).object?.sha));
    if (JSON.stringify(latestHeads) !== JSON.stringify([develop, main, controlSha])) return null;
    return { sha: develop, controlSha, mainSha: main, ciRunId: ci.id, stagingRunId: stage.id, preparationRunId: prep.id };
  }
  return null;
}

export async function checkRehearsalCandidate(reader, env) {
  if (env.GITHUB_REPOSITORY !== repository || env.GITHUB_REF !== 'refs/heads/ci-control'
      || env.GITHUB_RUN_ATTEMPT !== '1' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
      || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') || env.GITHUB_SHA !== env.PULBASE_EXPECTED_CONTROL_SHA) {
    throw Error('保護されたci-controlの初回実行に限ります。');
  }
  const input = {
    sha: env.INPUT_SHA, controlSha: env.GITHUB_SHA, mainSha: env.INPUT_MAIN_SHA,
    ciRunId: Number(env.INPUT_CI_RUN_ID), stagingRunId: Number(env.INPUT_STAGING_RUN_ID),
    preparationRunId: Number(env.INPUT_PREPARATION_RUN_ID),
  };
  const observed = await discoverRelease({ ...reader, controlSha: env.GITHUB_SHA, releaseRunId: env.GITHUB_RUN_ID });
  if (JSON.stringify(observed) !== JSON.stringify(input)) throw Error('承認対象のSHAまたは証跡が変わりました。');
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  if (env.RELEASE_PLAN_FINGERPRINT !== undefined && env.RELEASE_PLAN_FINGERPRINT !== fingerprint) {
    throw Error('承認待ちに固定した候補と一致しません。');
  }
  return { ...input, fingerprint, mainUpdated: false, deploymentRequested: false };
}

export async function discoverFromStaging({ requestedRun, pause = delay, ...options }) {
  const runId = Number(requestedRun);
  if (!/^[1-9][0-9]*$/.test(requestedRun) || !id(runId) || !sha.test(options.controlSha ?? '')) {
    throw Error('検証公開の起動元が不正です。');
  }
  for (let checked = 0; checked < 15; checked += 1) {
    const run = await options.api('actions/runs/' + runId);
    if (run.id !== runId || run.path !== '.github/workflows/' + workflow.staging
        || run.head_repository?.full_name !== repository || run.head_branch !== 'ci-control'
        || run.head_sha !== options.controlSha || run.event !== 'workflow_dispatch' || run.run_attempt !== 1) {
      throw Error('固定した検証公開の初回実行ではありません。');
    }
    if (run.status === 'completed') {
      if (run.conclusion !== 'success') return null;
      const candidate = await discoverRelease(options);
      return candidate?.stagingRunId === runId ? candidate : null;
    }
    if (checked < 14) await pause(2000);
  }
  throw Error('検証公開runの完了を確認できません。');
}

async function main() {
  const mode = process.argv[2];
  if (process.argv.length > 3 || (mode !== undefined && mode !== '--rehearse')) throw Error('対象外モードです。');
  const reader = candidateDiscoveryReader();
  const options = { ...reader, controlSha: process.env.PULBASE_EXPECTED_CONTROL_SHA };
  let result;
  if (mode === '--rehearse') result = await checkRehearsalCandidate(reader, process.env);
  else if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    result = await discoverFromStaging({ ...options, requestedRun: process.env.REQUESTED_STAGING_RUN_ID });
  } else result = await discoverRelease(options);
  if (result && process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, 'candidate=' + JSON.stringify(result) + '\n'
      + (mode === '--rehearse' ? 'fingerprint=' + result.fingerprint + '\n' : ''));
  }
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('本番候補の照合を停止しました。認証値や元応答は表示しません。'); process.exitCode = 1; });
}
