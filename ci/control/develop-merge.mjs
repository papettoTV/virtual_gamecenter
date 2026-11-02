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
