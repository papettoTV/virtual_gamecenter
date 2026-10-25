import {trustPolicy} from './review-trust.mjs';
// Fixed, keyless preparation for one develop deployment and one regression pass.
import {createHash} from 'node:crypto';
const repo='papettoTV/virtual_gamecenter',sha=v=>/^[a-f0-9]{40}$/.test(v??''),id=v=>/^[1-9][0-9]*$/.test(String(v??''));
function need(v,m){if(!v)throw Error(m);}
function full(x,k){need(Array.isArray(x[k])&&x.total_count===x[k].length&&x.total_count<100,'証跡一覧が不完全');return x[k];}
export async function developEvidence(api,runId,policy,now=Date.now()){
 trustPolicy(policy);need(id(runId),'CI run ID不正');
 const run=await api(`actions/runs/${runId}`),at=Date.parse(run.created_at);
 need(String(run.id)===String(runId)&&run.event==='push'&&run.head_branch==='develop'&&run.head_repository?.full_name===repo
  &&run.path==='.github/workflows/web-checks.yml'&&run.status==='completed'&&run.conclusion==='success'&&run.run_attempt===1
  &&sha(run.head_sha)&&Number.isFinite(at)&&at<=now+30000&&now-at<=86400000,'developの初回成功CI以外・古いCIは拒否');
 const revision=run.head_sha;
 need((await api('git/ref/heads/develop')).object?.sha===revision,'古いdevelopの公開は拒否');
 const runs=full(await api(`actions/workflows/web-checks.yml/runs?head_sha=${revision}&event=push&per_page=100`),'workflow_runs');
 const latest=runs.filter(r=>r.head_sha===revision&&r.event==='push').sort((a,b)=>b.id-a.id)[0];
 need(latest?.id===run.id&&latest.run_attempt===1&&latest.status==='completed'&&latest.conclusion==='success','最新CIの変更・再実行を拒否');
 const jobs=full(await api(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`),'jobs');
 need(['verify','Automation control checks'].every(n=>jobs.filter(j=>j.name===n&&j.status==='completed'&&j.conclusion==='success').length===1),'必須CI不合格');
 const commit=await api(`git/commits/${revision}`);need(sha(commit.tree?.sha),'実コミットのtree不正');
 const tree=await api(`git/trees/${revision}?recursive=1`);
 need(tree.truncated===false&&Array.isArray(tree.tree)&&tree.tree.length<20000,'固定定義のtreeが不完全');
 need(policy?.version===1&&policy.repository===repo&&Object.keys(policy.files??{}).length>=20,'保護された固定定義が必要');
 for(const [path,expected] of Object.entries(policy.files)){
  const x=tree.tree.filter(x=>x.path===path);need(x.length===1&&x[0].type==='blob'&&x[0].mode==='100644'&&x[0].sha===expected,'CI・設定の固定定義が不一致: '+path);
 }
 const artifacts=full(await api(`actions/runs/${run.id}/artifacts?per_page=100`),'artifacts');
 const matches=artifacts.filter(a=>a.name===`staging-build-${revision}-1`);
 const a=matches[0];need(matches.length===1&&!a.expired&&a.size_in_bytes>0&&a.size_in_bytes<=250*1024*1024
  &&a.workflow_run?.id===run.id&&a.workflow_run.head_sha===revision,'実SHAの成果物が不一致・期限切れ');
 return {repository:repo,environment:'staging',sha:revision,tree:commit.tree.sha,runId:String(run.id),attempt:'1',artifactId:String(a.id),
  policyDigest:createHash('sha256').update(JSON.stringify(policy)).digest('hex')};
}
function context(x){need(x?.repository===repo&&x.ref==='refs/heads/ci-control'&&x.event==='workflow_dispatch'
 &&x.environment==='staging'&&id(x.runId)&&x.attempt==='1'&&sha(x.controlSha),'保護された初回の制御実行以外は拒否');}
export function releaseScope(evidence,execution,manifestDigest,now=Date.now()){
 context(execution);need(evidence.repository===repo&&evidence.environment==='staging'&&sha(evidence.sha)&&sha(evidence.tree)
  &&id(evidence.runId)&&id(evidence.artifactId)&&evidence.attempt==='1'&&/^[a-f0-9]{64}$/.test(evidence.policyDigest??'')
  &&/^[a-f0-9]{64}$/.test(manifestDigest??'')&&Number.isSafeInteger(now),'承認対象の識別子不正');
 return Object.freeze({evidence:Object.freeze(structuredClone(evidence)),execution:Object.freeze(structuredClone(execution)),manifestDigest,approvedAt:now,expiresAt:now+3600000});
}
export async function runPostmergeStaging({scope,execution,observe,publish,regress,now=Date.now}){
 context(execution);need(JSON.stringify(scope.execution)===JSON.stringify(execution),'別runへの承認流用を拒否');
 let phase='before-publication',publicationAttempted=false;
 async function current(){const t=now();need(t>=scope.approvedAt&&t<scope.expiresAt,'承認期限切れ');need(JSON.stringify(await observe())===JSON.stringify(scope.evidence),'承認後にdevelop・CI・成果物が変更');}
 try{
  await current();phase='publication';publicationAttempted=true;await publish(scope.evidence);
  await current();phase='regression';const result=await regress(scope.evidence);
  need(result?.passed===true&&result.sha===scope.evidence.sha,'staging回帰テスト不合格');
  await current();return {status:'passed',sha:scope.evidence.sha,approvalCount:1,publicationCount:1,regressionCount:1,
   recovery:'fix-pull-request',mainUpdated:false,productionRequested:false};
 }catch{const e=Error('検証を停止しました。結果を確認し修正PRで対応してください。');e.phase=phase;e.sha=scope.evidence.sha;e.publicationAttempted=publicationAttempted;e.recovery='fix-pull-request';throw e;}
}
