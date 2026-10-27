// Only orchestrates fixed ci-control modules; never checks out or executes a PR.
import {readFile,writeFile,appendFile,lstat,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
export const CONTROL_SHA='2c883a1cdd961510a0557742f74294739752f445';
export const RULE_VERSIONS={ciControl:'2026-10-26T23:03:01.235Z',main:'2026-10-21T20:32:35.191Z',protectionMode:'strict'};
const repository='papettoTV/virtual_gamecenter',sha=v=>/^[a-f0-9]{40}$/.test(v??''),id=v=>/^[1-9][0-9]*$/.test(String(v??''));
function need(v,m){if(!v)throw Error(m);}
export function context(env=process.env){
 need(env.GITHUB_REPOSITORY===repository&&env.GITHUB_REF==='refs/heads/develop'&&env.GITHUB_EVENT_NAME==='workflow_run'
  &&env.GITHUB_RUN_ATTEMPT==='1'&&env.SOURCE_ATTEMPT==='1'&&id(env.GITHUB_RUN_ID)&&id(env.REVIEW_RUN_ID)
  &&env.PULBASE_CODEX_ENABLED==='true'&&env.PULBASE_DEVELOP_AUTO_MERGE_ENABLED==='true'
  &&env.EXPECTED_CONTROL_SHA===CONTROL_SHA&&sha(env.GITHUB_SHA),'初回のdevelop自動起動と固定制御SHA・有効化設定が必要です');
 return {repository,ref:env.GITHUB_REF,event:env.GITHUB_EVENT_NAME,runId:env.GITHUB_RUN_ID,attempt:'1',controlSha:CONTROL_SHA,environment:'automation'};
}
export function mergeTransport(token,intent,request=fetch){
 need(token&&id(intent.pullNumber)&&sha(intent.head),'開発用App認証と固定PRが必要です');
 return async(method,path,body)=>{
  const reads=path==='branches/develop/protection'||path==='git/ref/heads/develop'||/^git\/commits\/[a-f0-9]{40}$/.test(path);
  const merge=method==='PUT'&&path===`pulls/${intent.pullNumber}/merge`&&JSON.stringify(body)===JSON.stringify({sha:intent.head,merge_method:'squash'});
  need((method==='GET'&&reads&&body===undefined)||merge,'developの固定PRマージ以外の書込は拒否します');
  try{
   const r=await request(`https://api.github.com/repos/${repository}/${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(merge?{'Content-Type':'application/json'}:{})},redirect:'error',signal:AbortSignal.timeout(15000),...(merge?{body:JSON.stringify(body)}:{})});
   if(!r.ok){await r.body?.cancel();throw Error();}return await r.json();
  }catch{throw Error('開発用AppのAPI確認に失敗しました。認証・応答は表示しません');}
 };
}
export async function performAutoMerge({receipt,api,write,execution,control,policy,now=Date.now}){
 need(receipt?.reviewRun&&id(receipt.reviewRun),'レビュー証跡が必要です');
 let last,phase='protection';
 const protection=()=>control.verifyProtection(control.protectionApi,execution,{ruleVersions:JSON.stringify(RULE_VERSIONS)});
 const guard=async()=>{
  phase='protection';const p=await protection();need(p.protectionVerified&&p.protectionMode==='strict','strictの保護確認が必要です');
  phase='evidence';last=await control.premergeDecision(api,receipt,policy,now());
  need(last.eligible===true&&last.reviewTrust?.reviewTrustVerified===true,'CI・レビューの信頼条件が未合格です');
 };
 try{
 await guard();
 const intent={repository,baseRef:'develop',pullNumber:last.pullNumber,head:last.head,base:last.base,tree:last.tree};
 phase='merge';const result=await control.mergeReviewedCandidate(intent,{api:write(intent),guard});
 try{await protection();}catch{const error=Error('マージ後の保護再確認で停止しました');error.outcome='merged-unverified';error.mergedSha=result.sha;throw error;}
 return {status:'passed',mode:'develop-reviewed-auto-merge',controlSha:CONTROL_SHA,protectionMode:'strict',reviewRun:String(receipt.reviewRun),...result,realMergeExecuted:true,stagingDeploymentRequested:false,productionRequested:false};
 }catch(error){error.failureStage=error.outcome?'merge':phase;throw error;}
}
export function failureReport(error){
 const outcome=['unknown','not-confirmed','merged-unverified'].includes(error?.outcome)?error.outcome:'stopped';
 const message=String(error?.message??'');
 const reason=[['definition-changed',/固定版と不一致|追加のエージェント設定|信頼定義/],['stale-candidate',/古いPR|古いbase|候補の親/],['issue-assignment',/自動実装Issue|公開なし試験Issue/],['ci-or-review',/CI・レビュー|レビュー結果|成功CI|成功レビュー/],['artifact',/成果物|証跡/],['protection',/保護|例外|strict|mainが|制御ブランチ/]].find(([,pattern])=>pattern.test(message))?.[0]??'unclassified';
 return {status:'failed',mode:'develop-reviewed-auto-merge',outcome,stopReason:reason,failureStage:['protection','evidence','merge'].includes(error?.failureStage)?error.failureStage:'source-or-receipt',mergedSha:sha(error?.mergedSha)?error.mergedSha:null,automaticRetry:false,productionRequested:false};
}
export async function readReceipt(directory){
 need(JSON.stringify((await readdir(directory)).sort())===JSON.stringify(['review-receipt.json']),'レビュー証跡のファイル集合が不正です');
 const file=resolve(directory,'review-receipt.json'),st=await lstat(file);
 need(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<65536,'レビュー証跡の形式が不正です');
 return JSON.parse(await readFile(file,'utf8'));
}
async function main(){
 const x=context(),root=resolve('fixed-control/ci/control');
 const load=name=>import(pathToFileURL(resolve(root,name)));
 const [e,p,d,m]=await Promise.all(['candidate-evidence.mjs','protection-check.mjs','premerge-decision.mjs','develop-merge.mjs'].map(load));
 const api=e.apiRead(process.env.GH_TOKEN),protectionApi=p.readApi(process.env.GH_TOKEN),run=process.env.REVIEW_RUN_ID;
 const control={...d,...m,verifyProtection:p.verifyProtection,protectionApi};
 const policy=JSON.parse(await readFile(resolve(root,'review-trust.json'),'utf8'));
 if(process.argv[2]==='locate'){
  await p.verifyProtection(protectionApi,x,{ruleVersions:JSON.stringify(RULE_VERSIONS)});
  const source=await e.sourceRun(api,run);
  need(source.pull_requests?.length===1,'レビュー実行のPRが一意ではありません');
  const pr=await api(`pulls/${source.pull_requests[0].number}`);
  if(pr.user?.login!=='pulbase-codex[bot]'){
   await appendFile(process.env.GITHUB_OUTPUT,'eligible=false\n');return;
  }
  const artifact=await e.receiptArtifact(api,run);
  await appendFile(process.env.GITHUB_OUTPUT,`eligible=true\nreceipt_id=${artifact.id}\n`);return;
 }
 need(process.argv[2]==='merge','不明なモード');
 const receipt=await readReceipt('receipt');need(String(receipt.reviewRun)===run,'別レビュー実行の証跡です');
 const result=await performAutoMerge({receipt,api,execution:x,control,policy,write:intent=>mergeTransport(process.env.APP_TOKEN,intent)});
 await writeFile('develop-merge-result.json',JSON.stringify(result,null,2));
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## developへの自動マージ成功\nPR: #${result.pullNumber}\n実マージSHA: ${result.sha}\n\nこのSHAの初回CI成功後、保護されたci-controlがstaging承認1回を待ちます。main・本番公開・X投稿は行っていません。\n`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(async error=>{
 const result=failureReport(error);
 await writeFile('develop-merge-result.json',JSON.stringify(result,null,2));console.error('自動マージを停止しました。CI・レビュー・現在のSHA・保護設定を確認してください。自動再試行はしません。');process.exitCode=1;
});
