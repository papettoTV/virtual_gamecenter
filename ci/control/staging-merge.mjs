// Explicit transport only: not called by any active workflow.
const repo='papettoTV/virtual_gamecenter',sha=v=>/^[a-f0-9]{40}$/.test(v??'');
function need(v,m){if(!v)throw Error(m);}
export class MergeStopped extends Error{
 constructor(outcome,mergedSha=null){super('developマージを停止しました。結果を確認してから復旧を判断してください。');this.outcome=outcome;this.mergedSha=mergedSha;}
}
export async function mergeReviewedCandidate(intent,{api,guard}={}){
 need(typeof api==='function'&&typeof guard==='function','マージの明示transportとguardが必要');
 need(intent.repository===repo&&intent.baseRef==='develop'&&/^[1-9][0-9]*$/.test(String(intent.pullNumber))&&['head','base','tree'].every(k=>sha(intent[k])),'マージ対象不正');
 await guard();const protection=await api('GET','branches/develop/protection');
 need(protection.enforce_admins?.enabled===true&&protection.required_status_checks?.strict===true,'develop保護不十分');
 const checks=protection.required_status_checks.checks??[];
 need(['verify','Automation control checks'].every(n=>checks.some(c=>c.context===n&&c.app_id===15368)),'必須CIの発行元不一致');
 await guard();
 let response;
 try{response=await api('PUT',`pulls/${intent.pullNumber}/merge`,{sha:intent.head,merge_method:'squash'});}catch{throw new MergeStopped('unknown');}
 if(response?.merged!==true||!sha(response.sha))throw new MergeStopped('not-confirmed');
 const actual=response.sha;
 try{
  const commit=await api('GET',`git/commits/${actual}`),develop=await api('GET','git/ref/heads/develop');
  need(commit.tree?.sha===intent.tree&&commit.parents?.length===1&&commit.parents[0].sha===intent.base&&develop.object?.sha===actual,'マージ内容不一致');
  return {repository:repo,baseRef:'develop',pullNumber:String(intent.pullNumber),head:intent.head,merged:true,method:'squash',sha:actual,tree:commit.tree.sha,parents:[intent.base],develop:actual};
 }catch{throw new MergeStopped('merged-unverified',actual);}
}
export async function mergedCiEvidence(merged,api){
 need(merged.repository===repo&&merged.baseRef==='develop'&&sha(merged.sha)&&sha(merged.tree),'実マージ対象不正');
 const data=await api('GET',`actions/workflows/web-checks.yml/runs?head_sha=${merged.sha}&event=push&per_page=100`);
 need(data.total_count<100&&data.total_count===data.workflow_runs?.length,'実SHAのCI一覧が不完全');
 const r=data.workflow_runs.filter(r=>r.head_sha===merged.sha&&r.event==='push').sort((a,b)=>b.id-a.id)[0];
 if(!r||r.status!=='completed')return null;
 need(r.conclusion==='success'&&r.run_attempt===1&&r.head_branch==='develop'&&r.head_repository?.full_name===repo&&r.path==='.github/workflows/web-checks.yml','実SHAの最新初回CIが未合格');
 const jobs=await api('GET',`actions/runs/${r.id}/jobs?filter=latest&per_page=100`);
 need(jobs.total_count===jobs.jobs?.length&&jobs.total_count<100&&['verify','Automation control checks'].every(n=>jobs.jobs.filter(j=>j.name===n&&j.status==='completed'&&j.conclusion==='success').length===1),'実SHAの必須CI未合格');
 const artifacts=await api('GET',`actions/runs/${r.id}/artifacts?per_page=100`);
 need(artifacts.total_count===artifacts.artifacts?.length&&artifacts.total_count<100,'実SHAの成果物一覧が不完全');
 const a=artifacts.artifacts.filter(a=>a.name===`staging-build-${merged.sha}-1`&&!a.expired);
 need(a.length===1&&a[0].workflow_run?.id===r.id&&a[0].workflow_run?.head_sha===merged.sha&&a[0].size_in_bytes>0&&a[0].size_in_bytes<=250*1024*1024,'実SHAの成果物出所不一致');
 need((await api('GET','git/ref/heads/develop')).object?.sha===merged.sha,'実マージ後にdevelopが変更');
 const commit=await api('GET',`git/commits/${merged.sha}`);need(commit.tree?.sha===merged.tree&&commit.parents?.length===1&&commit.parents[0].sha===merged.parents[0],'実マージのtree・親不一致');
 return {sha:merged.sha,tree:merged.tree,event:'push',checkSha:merged.sha,runId:String(r.id),attempt:'1',artifactId:String(a[0].id),ciPassed:true};
}
