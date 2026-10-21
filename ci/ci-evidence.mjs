import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { assertSha, assertIssueNumber } from './policy.mjs';
import { assertAutomaticIssue } from './issue-routing.mjs';
export function githubApi(repository, token, request = fetch) {
  if (repository !== 'papettoTV/virtual_gamecenter' || !token) throw Error('Unexpected repository or missing read token');
  return async path => {
    const response = await request(`https://api.github.com/repos/${repository}/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) { await response.body?.cancel(); throw Error('GitHub read failed'); }
    return response.json();
  };
}
export async function ciEvidence({ api, repository, checkSha, buildSha, event, runId }) {
  assertSha(checkSha); assertSha(buildSha);
  if (!['push', 'pull_request'].includes(event)) throw Error('Unexpected CI event');
  const runs = await api(`actions/workflows/web-checks.yml/runs?head_sha=${checkSha}&event=${event}&per_page=100`);
  const run = runs.workflow_runs.filter(r => r.head_sha === checkSha && r.event === event).sort((a, b) => b.id - a.id)[0];
  if (!run || run.status !== 'completed') return null;
  if (run.conclusion !== 'success' || run.path !== '.github/workflows/web-checks.yml' || run.head_repository?.full_name !== repository || (event === 'push' && run.head_branch !== 'develop') || (runId && String(run.id) !== String(runId))) throw Error('Latest CI run is not eligible');
  const jobs = await api(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
  if (!['verify', 'Automation control checks'].every(name => jobs.jobs.some(job => job.name === name && job.status === 'completed' && job.conclusion === 'success'))) throw Error('Required CI jobs did not succeed');
  const artifacts = await api(`actions/runs/${run.id}/artifacts?per_page=100`);
  const name = `staging-build-${buildSha}-${run.run_attempt}`;
  const matching = artifacts.artifacts.filter(a => a.name === name && !a.expired && a.workflow_run?.id === run.id && a.workflow_run?.head_sha === checkSha);
  if (matching.length !== 1 || !Number.isSafeInteger(matching[0].size_in_bytes) || matching[0].size_in_bytes < 1 || matching[0].size_in_bytes > 250 * 1024 * 1024) throw Error('Exact CI artifact is missing or ambiguous');
  return { runId: String(run.id), attempt: String(run.run_attempt), artifactId: String(matching[0].id) };
}
export async function waitForCi(options, { attempts = 60, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let i = 0; i < attempts; i++) {
    const result = await ciEvidence(options);
    if (result) return result;
    if (i < attempts - 1) await wait(10000);
  }
  throw Error('CI evidence timed out');
}
export async function assertCurrentTarget({ api, expectedBase, checkSha, pullNumber }) {
  assertSha(expectedBase); assertSha(checkSha);
  const branch = await api('git/ref/heads/develop');
  if (branch.object?.sha !== expectedBase) throw Error('develop moved before deployment');
  if (pullNumber) {
    const pr = await api(`pulls/${assertIssueNumber(pullNumber)}`);
    if (pr.state !== 'open' || pr.draft || pr.base?.ref !== 'develop' || pr.base.sha !== expectedBase || pr.head?.sha !== checkSha || pr.head.repo?.full_name !== 'papettoTV/virtual_gamecenter') throw Error('PR changed before deployment');
    if (!/^codex\/issue-[1-9][0-9]*$/.test(pr.head.ref)) throw Error('Unexpected automation branch');
    assertAutomaticIssue(await api(`issues/${assertIssueNumber(pr.head.ref.replace('codex/issue-', ''))}`));
  } else if (checkSha !== expectedBase) throw Error('Unexpected develop deployment SHA');
}
export function evidenceOptions(env = process.env) {
  return { api: githubApi(env.GITHUB_REPOSITORY, env.GH_TOKEN), repository: env.GITHUB_REPOSITORY,
    checkSha: env.PULBASE_CHECK_SHA, buildSha: env.PULBASE_RELEASE_SHA, event: env.PULBASE_CI_EVENT, runId: env.PULBASE_CI_RUN_ID };
}
export async function assertDeploymentCi(env = process.env) {
  const options = evidenceOptions(env);
  const evidence = await ciEvidence(options);
  if (!evidence || evidence.runId !== env.PULBASE_CI_RUN_ID || evidence.attempt !== env.PULBASE_CI_ATTEMPT || evidence.artifactId !== env.PULBASE_ARTIFACT_ID) throw Error('CI evidence changed before deployment');
  await assertCurrentTarget({ api: options.api, expectedBase: env.PULBASE_EXPECTED_BASE, checkSha: options.checkSha, pullNumber: env.PULBASE_PR_NUMBER });
  return evidence;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = evidenceOptions();
    const evidence = await waitForCi(options);
    await assertCurrentTarget({ api: options.api, expectedBase: process.env.PULBASE_EXPECTED_BASE, checkSha: options.checkSha, pullNumber: process.env.PULBASE_PR_NUMBER });
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries(evidence).map(([key, value]) => `${key}=${value}\n`).join(''));
    console.log('同じSHAの必須CI成功・成果物・現在のdevelopを確認しました。');
  } catch { console.error('公開条件を満たす同じSHAのCI・成果物を確認できません。公開を停止します。'); process.exitCode = 1; }
}
