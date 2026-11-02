// Cancel obsolete approvals, never an executing deployment. No deployment credentials.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, appendFile} from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';

export const repository = 'papettoTV/virtual_gamecenter';
const workflowPath = '.github/workflows/postmerge-staging.yml';
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
const id = x => Number.isSafeInteger(x) && x > 0;
const runStates = ['waiting', 'queued', 'pending', 'in_progress'];
// These modules are loaded before the stale-SHA guard. Compare all of them,
// including the workflow, before accepting an older control revision.
export const guardFiles = [workflowPath, ...[
  'candidate-evidence', 'fixed-process', 'fixed-staging-operations', 'postmerge-runner',
  'postmerge-staging', 'protection-check', 'review-trust', 'staging-gateway',
  'staging-publication', 'staging-regression',
].map(p => 'ci/control/' + p + '.mjs')];
function need(value, code) { if (!value) throw new Error(code); }
function complete(value, key) {
  need(Array.isArray(value?.[key]) && value.total_count === value[key].length && value.total_count < 100, 'incomplete-list');
  return value[key];
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Read exactly one small JSON entry in memory. Never extract archive paths,
// execute its contents, accept encrypted/ZIP64 archives, or inflate unbounded data.
export function readApprovalZip(input) {
  const b = Buffer.from(input);
  need(b.length >= 22 && b.length <= 65536, 'invalid-approval-zip');
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) { end = i; break; }
  }
  need(end >= 0 && b.readUInt16LE(end + 4) === 0 && b.readUInt16LE(end + 6) === 0
    && b.readUInt16LE(end + 8) === 1 && b.readUInt16LE(end + 10) === 1, 'invalid-approval-zip');
  const offset = b.readUInt32LE(end + 16), size = b.readUInt32LE(end + 12);
  need(size >= 46 && offset + size === end && offset + 46 <= end && b.readUInt32LE(offset) === 0x02014b50, 'invalid-approval-zip');
  const flags = b.readUInt16LE(offset + 8), method = b.readUInt16LE(offset + 10);
  const crc = b.readUInt32LE(offset + 16), packed = b.readUInt32LE(offset + 20), unpacked = b.readUInt32LE(offset + 24);
  const nameLength = b.readUInt16LE(offset + 28), extraLength = b.readUInt16LE(offset + 30), commentLength = b.readUInt16LE(offset + 32);
  need(b.readUInt16LE(offset + 6) <= 20 && (flags & ~0x808) === 0 && [0, 8].includes(method) && packed > 0 && packed <= 65536
    && unpacked > 0 && unpacked <= 32768 && b.readUInt32LE(offset + 42) === 0
    && 46 + nameLength + extraLength + commentLength === size && b.readUInt16LE(offset + 34) === 0
    && b.subarray(offset + 46, offset + 46 + nameLength).toString('utf8') === 'postmerge-approval.json', 'invalid-approval-zip');
  need(b.readUInt32LE(0) === 0x04034b50 && b.readUInt16LE(4) <= 20 && b.readUInt16LE(6) === flags && b.readUInt16LE(8) === method, 'invalid-approval-zip');
  const localName = b.readUInt16LE(26), start = 30 + localName + b.readUInt16LE(28);
  need(localName === nameLength && b.subarray(30, 30 + localName).toString('utf8') === 'postmerge-approval.json'
    && start <= offset && start + packed <= offset, 'invalid-approval-zip');
  const data = method === 0 ? b.subarray(start, start + packed)
    : inflateRawSync(b.subarray(start, start + packed), {maxOutputLength: 32768});
  need(data.length === unpacked && crc32(data) === crc, 'invalid-approval-zip');
  const value = JSON.parse(data.toString('utf8'));
  need(value && typeof value === 'object' && !Array.isArray(value), 'invalid-approval-json');
  return value;
}

function assertRun(run, workflowId) {
  need(id(run?.id) && run.workflow_id === workflowId && run.path === workflowPath
    && run.repository?.full_name === repository && run.head_repository?.full_name === repository
    && run.event === 'workflow_dispatch' && run.head_branch === 'ci-control'
    && run.run_attempt === 1 && sha(run.head_sha) && runStates.includes(run.status), 'not-control-first-run');
}
async function waiting(api, runId) {
  const jobs = complete(await api('actions/runs/' + runId + '/jobs?filter=latest&per_page=100'), 'jobs');
  const prepare = jobs.find(j => j.name === 'prepare'), stage = jobs.find(j => j.name === 'staging');
  need(jobs.length === 2 && prepare?.status === 'completed' && prepare.conclusion === 'success'
    && stage?.status === 'waiting' && stage.started_at === null && Array.isArray(stage.steps) && stage.steps.length === 0, 'not-unstarted-approval');
  const pending = await api('actions/runs/' + runId + '/pending_deployments');
  need(Array.isArray(pending) && pending.length === 1 && pending[0].environment?.name === 'staging'
    && pending[0].reviewers?.length === 1 && pending[0].reviewers[0].type === 'User'
    && pending[0].reviewers[0].reviewer?.login === 'papettoTV', 'not-staging-human-approval');
}
async function ancestor(api, older, newer) {
  need(sha(older) && sha(newer) && older !== newer, 'not-obsolete');
  const c = await api('compare/' + older + '...' + newer);
  need(c.status === 'ahead' && c.ahead_by > 0 && c.behind_by === 0 && c.base_commit?.sha === older
    && c.merge_base_commit?.sha === older, 'not-strict-ancestor');
}
async function guardTree(api, revision) {
  const tree = await api('git/trees/' + revision + '?recursive=1');
  need(tree.truncated === false && Array.isArray(tree.tree) && tree.tree.length < 20000, 'incomplete-control-tree');
  return guardFiles.map(path => {
    const entries = tree.tree.filter(entry => entry.path === path);
    need(entries.length === 1 && entries[0].type === 'blob' && entries[0].mode === '100644' && sha(entries[0].sha), 'unknown-control-guard');
    return entries[0].sha;
  });
}
async function compatibleGuard(api, run, controlSha, guards) {
  if (run.head_sha === controlSha) return;
  await ancestor(api, run.head_sha, controlSha);
  need(JSON.stringify(await guardTree(api, run.head_sha)) === JSON.stringify(guards), 'changed-control-guard');
}
async function inspect(api, load, listed, snapshot, workflowId, guards) {
  const run = await api('actions/runs/' + listed.id);
  assertRun(run, workflowId);
  need(run.id === listed.id && run.head_sha === listed.head_sha, 'changed-run');
  await compatibleGuard(api, run, snapshot.controlSha, guards);
  await waiting(api, run.id);
  const artifacts = complete(await api('actions/runs/' + run.id + '/artifacts?per_page=100'), 'artifacts');
  const matches = artifacts.filter(a => a.name === 'postmerge-approval-' + run.id + '-1');
  const a = matches[0];
  need(matches.length === 1 && id(a.id) && !a.expired && a.size_in_bytes > 0 && a.size_in_bytes <= 65536
    && a.workflow_run?.id === run.id && a.workflow_run.head_sha === run.head_sha, 'untrusted-approval-artifact');
  const p = await load(a.id), x = p.execution, e = p.evidence;
  need(p.version === 3 && p.mode === 'postmerge-staging-live'
    && x?.repository === repository && x.environment === 'staging' && x.ref === 'refs/heads/ci-control'
    && x.event === 'workflow_dispatch' && x.runId === String(run.id) && x.attempt === '1' && x.controlSha === run.head_sha
    && e?.repository === repository && e.environment === 'staging' && e.attempt === '1'
    && /^[1-9][0-9]*$/.test(e.runId ?? '') && /^[1-9][0-9]*$/.test(e.artifactId ?? '') && sha(e.sha) && sha(e.tree)
    && /^[a-f0-9]{64}$/.test(e.policyDigest ?? '') && /^[a-f0-9]{64}$/.test(p.manifestDigest ?? '')
    && Number.isSafeInteger(p.files) && p.files > 0 && p.files < 20000
    && p.protection?.preflightReady === true && p.protection.deploymentRequested === false
    && JSON.stringify(p.protection.execution) === JSON.stringify(x), 'untrusted-approval-scope');
  await ancestor(api, e.sha, snapshot.developSha);
  const ci = await api('actions/runs/' + e.runId);
  need(String(ci.id) === e.runId && ci.path === '.github/workflows/web-checks.yml' && ci.event === 'push'
    && ci.head_branch === 'develop' && ci.head_sha === e.sha && ci.head_repository?.full_name === repository
    && ci.run_attempt === 1 && ci.status === 'completed' && ci.conclusion === 'success', 'untrusted-source-ci');
  return {runId: run.id, sha: e.sha, controlSha: run.head_sha, artifactId: a.id, scope: JSON.stringify(p)};
}
async function snapshot(api, expected) {
  const controlSha = (await api('git/ref/heads/ci-control')).object?.sha;
  const developSha = (await api('git/ref/heads/develop')).object?.sha;
  need(sha(expected) && controlSha === expected && sha(developSha), 'control-or-develop-changed');
  return {controlSha, developSha};
}

export async function cleanupStaleStaging({api, load, cancel, expectedControlSha, apply = false}) {
  const current = await snapshot(api, expectedControlSha);
  const workflow = await api('actions/workflows/postmerge-staging.yml');
  need(id(workflow.id) && workflow.path === workflowPath && workflow.state === 'active', 'unexpected-workflow');
  const listed = new Map();
  for (const status of runStates) {
    const runs = complete(await api('actions/workflows/postmerge-staging.yml/runs?status=' + status + '&per_page=100'), 'workflow_runs');
    for (const run of runs) { need(id(run.id), 'invalid-run-id'); listed.set(run.id, run); }
  }
  need(listed.size < 100, 'too-many-pending-runs');
  const results = [], guards = listed.size ? await guardTree(api, current.controlSha) : [];
  for (const run of [...listed.values()].sort((a, b) => a.id - b.id)) {
    let candidate, cancelAttempted = false, cancelAccepted = false;
    try {
      candidate = await inspect(api, load, run, current, workflow.id, guards);
      if (!apply) { results.push({runId: run.id, sha: candidate.sha, outcome: 'would-cancel'}); continue; }
      // Re-read the immutable scope and the actual job/environment state. A
      // same-SHA duplicate cannot use this path: only strict ancestors qualify.
      const fresh = await inspect(api, load, run, current, workflow.id, guards);
      need(JSON.stringify(fresh) === JSON.stringify(candidate), 'changed-approval');
      need(JSON.stringify(await snapshot(api, expectedControlSha)) === JSON.stringify(current), 'changed-refs');
      await waiting(api, run.id);
      cancelAttempted = true;
      need(await cancel(run.id) === 202, 'cancel-not-accepted');
      cancelAccepted = true;
      const observed = await api('actions/runs/' + run.id);
      results.push({runId: run.id, sha: candidate.sha,
        outcome: observed.status === 'completed' && observed.conclusion === 'cancelled' ? 'cancelled' : 'cancel-requested'});
    } catch (error) {
      // No response bodies, signed URLs or credentials enter the audit report.
      const known = ['not-control-first-run', 'not-unstarted-approval', 'not-staging-human-approval', 'not-obsolete',
        'not-strict-ancestor', 'changed-control-guard', 'unknown-control-guard', 'untrusted-approval-artifact',
        'untrusted-approval-scope', 'untrusted-source-ci', 'changed-approval', 'changed-run', 'changed-refs',
        'control-or-develop-changed', 'cancel-not-accepted'];
      results.push({runId: run.id,
        outcome: cancelAccepted ? 'cancel-requested' : cancelAttempted ? 'cancel-outcome-unknown' : 'untouched',
        reason: known.includes(error.message) ? error.message : 'unverified-evidence'});
    }
  }
  return {version: 1, repository, ...current, apply, results, deploymentRequested: false, approvalRequested: false};
}

const execute = promisify(execFile);
export function cliPorts({apply = false, command = execute} = {}) {
  async function gh(args, maxBuffer = 8 * 1024 * 1024) {
    try {
      return (await command('gh', ['api', '--hostname', 'github.com', ...args],
        {encoding: 'buffer', timeout: 20000, maxBuffer, env: process.env})).stdout;
    } catch { throw new Error('github-api-unavailable'); }
  }
  const prefix = 'repos/' + repository + '/';
  return {
    api: async path => {
      need(/^(?:git\/ref\/heads\/(?:develop|ci-control)|git\/trees\/[a-f0-9]{40}\?recursive=1|compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40}|actions\/workflows\/postmerge-staging\.yml(?:\/runs\?status=(?:waiting|queued|pending|in_progress)&per_page=100)?|actions\/runs\/[1-9][0-9]*(?:\/(?:jobs\?filter=latest&per_page=100|artifacts\?per_page=100|pending_deployments))?)$/.test(path), 'unexpected-read-path');
      return JSON.parse((await gh([prefix + path])).toString('utf8'));
    },
    load: async artifactId => { need(id(artifactId), 'invalid-artifact-id'); return readApprovalZip(await gh([prefix + 'actions/artifacts/' + artifactId + '/zip'], 65536)); },
    cancel: async runId => {
      need(apply && id(runId), 'write-not-enabled');
      const headers = (await gh(['--method', 'POST', '--include', prefix + 'actions/runs/' + runId + '/cancel'], 65536)).toString('utf8');
      need(/^HTTP\/[^ ]+ 202\b/m.test(headers), 'cancel-not-accepted');
      return 202;
    },
  };
}

export function assertCleanupContext(env, event) {
  const source = event.workflow_run;
  need(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === repository
    && env.GITHUB_REF === 'refs/heads/develop' && env.GITHUB_EVENT_NAME === 'workflow_run'
    && env.GITHUB_RUN_ATTEMPT === '1' && !!env.GH_TOKEN
    && ['requested', 'completed'].includes(event.action) && source?.event === 'push' && source.run_attempt === 1
    && source.path === '.github/workflows/web-checks.yml' && source.head_branch === 'develop'
    && source.head_repository?.full_name === repository, 'unexpected-cleanup-context');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const apply = process.argv.length === 3 && process.argv[2] === '--apply';
    need(process.argv.length === 2 || apply, 'unexpected-arguments');
    if (apply) {
      const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
      assertCleanupContext(process.env, event);
    }
    const report = await cleanupStaleStaging({...cliPorts({apply}), expectedControlSha: process.env.EXPECTED_CONTROL_SHA, apply});
    console.log(JSON.stringify(report));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      '## 古いstaging承認待ちの整理\n\n公開・承認操作は行いません。\n\n' + report.results.map(r => '- Run ' + r.runId + ': ' + r.outcome + (r.reason ? ' (' + r.reason + ')' : '')).join('\n') + '\n');
  } catch {
    console.log(JSON.stringify({version: 1, status: 'unverified', deploymentRequested: false, approvalRequested: false}));
    console.error('キャンセル条件を確認できず停止しました。応答・認証値は表示しません。');
    process.exitCode = 1;
  }
}
