// Keyless evidence inspection only. This code never merges, dispatches or deploys.
import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const repo = 'papettoTV/virtual_gamecenter';
const sha = v => /^[a-f0-9]{40}$/.test(v ?? '');
const id = v => /^[1-9][0-9]*$/.test(String(v ?? ''));
function need(v, message) { if (!v) throw Error(message); }
function completeList(data, key, count = 'total_count') {
  need(Array.isArray(data[key]) && data[count] === data[key].length && data[key].length < 100, '証跡一覧が不完全'); return data[key];
}
export function execution(env) {
  need(env.GITHUB_REPOSITORY === repo && env.GITHUB_REF === 'refs/heads/develop'
    && env.GITHUB_EVENT_NAME === 'workflow_run' && env.GITHUB_RUN_ATTEMPT === '1' && sha(env.GITHUB_SHA)
    && id(env.GITHUB_RUN_ID), '初回のdevelop自動起動以外は拒否');
}
export function apiRead(token, request = fetch) {
  need(token, '読取認証なし');
  return async path => {
    need(/^(?:actions\/runs\/[1-9][0-9]*(?:\/(?:jobs\?filter=latest&per_page=100|artifacts\?per_page=100))?|actions\/workflows\/(?:web-checks|codex-pr)\.yml\/runs\?head_sha=[a-f0-9]{40}&event=pull_request&per_page=100|pulls\/[1-9][0-9]*|issues\/[1-9][0-9]*|git\/ref\/heads\/(?:develop|ci-control|main)|git\/commits\/[a-f0-9]{40}|git\/trees\/[a-f0-9]{40}\?recursive=1)$/.test(path), '対象外API');
    try {
      const response = await request(`https://api.github.com/repos/${repo}/${path}`, { method: 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) { await response.body?.cancel(); throw Error(); } return await response.json();
    } catch { throw Error('GitHub証跡を読み取れません'); }
  };
}
export async function sourceRun(api, runId) {
  need(id(runId), 'レビューrun不正');
  const run = await api(`actions/runs/${runId}`);
  need(String(run.id) === String(runId) && run.path === '.github/workflows/codex-pr.yml'
    && run.event === 'pull_request' && run.head_repository?.full_name === repo && run.run_attempt === 1
    && run.status === 'completed' && run.conclusion === 'success', '初回の成功レビューrun以外は拒否');
  return run;
}
export async function receiptArtifact(api, runId) {
  await sourceRun(api, runId);
  const items = completeList(await api(`actions/runs/${runId}/artifacts?per_page=100`), 'artifacts');
  const matches = items.filter(a => a.name === `codex-review-${runId}-1` && !a.expired);
  need(matches.length === 1 && matches[0].size_in_bytes > 0 && matches[0].size_in_bytes < 65536, 'レビュー証跡なし・重複・期限切れ');
  return matches[0];
}
export async function liveEvidence(api, r, expectedRun, { requireDryRunLabel = true } = {}) {
  need(r?.version === 1 && r.repository === repo && r.pass === true && Array.isArray(r.findings) && !r.findings.length
    && ['head','base','candidate','tree'].every(k => sha(r[k])) && ['pullNumber','reviewRun','buildRun','buildArtifact'].every(k => id(r[k]))
    && r.reviewAttempt === '1' && r.buildAttempt === '1' && String(r.reviewRun) === String(expectedRun), 'レビュー結果・SHA・runの結合が不正');
  const pr = await api(`pulls/${r.pullNumber}`);
  need(pr.state === 'open' && !pr.draft && pr.user?.login === 'pulbase-codex[bot]' && pr.base?.ref === 'develop'
    && pr.head?.repo?.full_name === repo && pr.base?.repo?.full_name === repo && /^codex\/issue-[1-9][0-9]*$/.test(pr.head.ref)
    && pr.head.sha === r.head && pr.base.sha === r.base && pr.merge_commit_sha === r.candidate, '古いPR・候補は拒否');
  const issue = await api(`issues/${pr.head.ref.slice('codex/issue-'.length)}`);
  const labels = (issue.labels ?? []).map(x => typeof x === 'string' ? x : x.name);
  need(issue.state === 'open' && labels.includes('実装:自動') && (!requireDryRunLabel || labels.includes('検証:公開なし')) && !labels.includes('実装:手元'), '公開なし自動実装Issue以外は拒否');
  need((await api('git/ref/heads/develop')).object?.sha === r.base, '古いbaseは拒否');
  const candidate = await api(`git/commits/${r.candidate}`);
  need(candidate.tree?.sha === r.tree && candidate.parents?.length === 2 && candidate.parents[0].sha === r.base && candidate.parents[1].sha === r.head, '候補の親・tree不一致');
  for (const [workflow, expected] of [['codex-pr',r.reviewRun],['web-checks',r.buildRun]]) {
    const runs = completeList(await api(`actions/workflows/${workflow}.yml/runs?head_sha=${r.head}&event=pull_request&per_page=100`), 'workflow_runs');
    const run = runs.filter(x => x.head_sha === r.head && x.event === 'pull_request').sort((a,b) => b.id-a.id)[0];
    need(run && String(run.id) === String(expected) && run.run_attempt === 1 && run.conclusion === 'success' && run.status === 'completed'
      && run.path === `.github/workflows/${workflow}.yml` && run.head_repository?.full_name === repo, '最新の初回成功CI・レビュー以外は拒否');
    const jobs = completeList(await api(`actions/runs/${expected}/jobs?filter=latest&per_page=100`), 'jobs');
    for (const name of workflow === 'web-checks' ? ['verify','Automation control checks'] : ['gate','Candidate tests','review','review-gate']) {
      const matches = jobs.filter(x => x.name === name);
      need(matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success', '必須CI・Codexレビュー未合格');
    }
  }
  await sourceRun(api, r.reviewRun);
  const artifacts = completeList(await api(`actions/runs/${r.buildRun}/artifacts?per_page=100`), 'artifacts');
  const matches = artifacts.filter(a => a.name === `staging-build-${r.candidate}-1`);
  const a = matches[0];
  need(matches.length === 1 && String(a.id) === String(r.buildArtifact) && !a.expired && a.size_in_bytes > 0 && a.size_in_bytes <= 250*1024*1024
    && String(a.workflow_run?.id) === String(r.buildRun) && a.workflow_run?.head_sha === r.head, '成果物の出所不一致');
  return { pullNumber: String(r.pullNumber), head: r.head, base: r.base, candidate: r.candidate, tree: r.tree,
    buildRun: String(r.buildRun), artifactId: String(a.id), reviewRun: String(r.reviewRun), evidenceOnly: labels.includes('検証:公開なし') };
}
export async function checkBuild(directory, r) {
  const manifestPath = join(directory, 'manifest.json');
  const st = await lstat(manifestPath); need(st.isFile() && !st.isSymbolicLink() && st.size < 4*1024*1024, 'manifest不正');
  const m = JSON.parse(await readFile(manifestPath, 'utf8'));
  need(m.version === 1 && m.environment === 'staging' && m.sha === r.candidate && m.tree === r.tree && m.runId === String(r.buildRun) && m.attempt === '1', 'manifestのSHA・run不一致');
  const found = []; let total = 0;
  async function walk(prefix = '') {
    for (const name of await readdir(join(directory,prefix))) {
      need(!/[\\\u0000-\u001f]/.test(name) && name !== '..' && (!name.startsWith('.') || name === '.assetsignore'), '成果物パス不正');
      const path = prefix ? `${prefix}/${name}` : name, full = join(directory,path), s = await lstat(full);
      need(!s.isSymbolicLink(), 'リンク拒否');
      if (s.isDirectory()) { need(path.split('/').length < 20, '深すぎる成果物'); await walk(path); }
      else {
        total += s.size; need(s.isFile() && total < 250*1024*1024 && found.length < 20000, '成果物サイズ不正');
        if (path === 'manifest.json') continue;
        need(path.startsWith('worker/') || path.startsWith('client/'), '成果物ルート不正');
        need(/^[a-f0-9]{64}$/.test(m.files?.[path]) && createHash('sha256').update(await readFile(full)).digest('hex') === m.files[path], '成果物ハッシュ不一致'); found.push(path);
      }
    }
  }
  await walk(); need(JSON.stringify(found.sort()) === JSON.stringify(Object.keys(m.files ?? {}).sort()), '成果物ファイル集合不一致');
  for (const p of ['worker/index.js','client/_worker.js']) need((await readFile(join(directory,p),'utf8')).includes(r.candidate), 'SHA刻印不一致');
  return found.length;
}
async function main() {
  execution(process.env);
  const api = apiRead(process.env.GH_TOKEN), run = process.env.REVIEW_RUN_ID;
  if (process.argv[2] === 'locate') {
    const a = await receiptArtifact(api,run);
    const { appendFile } = await import('node:fs/promises'); await appendFile(process.env.GITHUB_OUTPUT, `receipt_id=${a.id}\n`); return;
  }
  const receipt = JSON.parse(await readFile('receipt/review-receipt.json','utf8'));
  const first = await liveEvidence(api,receipt,run);
  if (process.argv[2] === 'prepare') {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_OUTPUT, `artifact_id=${first.artifactId}\nrun_id=${first.buildRun}\n`); return;
  }
  need(process.argv[2] === 'verify', '不明なモード');
  const files = await checkBuild(resolve('candidate-build'),receipt);
  await liveEvidence(api,receipt,run); // Recheck current candidate after downloading; never execute artifact code.
  const rejected = [];
  for (const [name, field, value] of [['head','head','0'.repeat(40)],['base','base','0'.repeat(40)],['candidate','candidate','0'.repeat(40)],['review-run','reviewRun','1'],['review-result','pass',false],['ci-rerun','buildAttempt','2']]) {
    let stopped = false; try { await liveEvidence(api,{...receipt,[field]:value},run); } catch { stopped=true; }
    need(stopped, '拒否試験が失敗'); rejected.push(name);
  }
  let rerunRejected=false; try { execution({...process.env,GITHUB_RUN_ATTEMPT:'2'}); } catch { rerunRejected=true; }
  need(rerunRejected, '再実行拒否に失敗');
  await writeFile('candidate-evidence.json',JSON.stringify({ mode:'real-evidence-dry-run', ...first, filesVerified:files,
    rejectionChecks:rejected, rerunRejected, realMergeExecuted:false, realDeploymentExecuted:false, productionRequested:false },null,2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode=1; });
}
