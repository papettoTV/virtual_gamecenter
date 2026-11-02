// Fixed staging live release; only a human-managed ci-control revision may activate this CLI.
import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {executionContext,readApi,verifyProtection} from './protection-check.mjs';
import {developEvidence,releaseScope,runPostmergeStaging} from './postmerge-staging.mjs';
import {checkBuild} from './candidate-evidence.mjs';
import {connectedStagingOperations} from './fixed-staging-operations.mjs';
import {sanitizeCommandFailure,sanitizeBrowserFailure} from './fixed-process.mjs';
import {PUBLICATION_STOP_REASONS} from './staging-publication.mjs';
import {trustPolicy} from './review-trust.mjs';
const releaseMode='postmerge-staging-live';
export function liveCredentials(env=process.env){
 const values={cloudflareToken:env.CLOUDFLARE_API_TOKEN,username:env.PULBASE_CHECK_USERNAME,password:env.PULBASE_CHECK_PASSWORD};
 need(Object.values(values).every(v=>typeof v==='string'&&v.trim().length>0),'staging用の公開鍵・Basic認証が未登録です');return values;
}
const policy=JSON.parse(await readFile(new URL('./review-trust.json',import.meta.url),'utf8'));trustPolicy(policy);
function need(v,m){if(!v)throw Error(m);}
function hash(b){return createHash('sha256').update(b).digest('hex');}
export function postmergeApi(token,request=fetch){
 need(token,'読取認証なし');return async path=>{
 need(/^(?:git\/ref\/heads\/develop|git\/commits\/[a-f0-9]{40}|git\/trees\/[a-f0-9]{40}\?recursive=1|actions\/runs\/[1-9][0-9]*(?:\/(?:jobs\?filter=latest&per_page=100|artifacts\?per_page=100))?|actions\/workflows\/web-checks\.yml\/runs\?head_sha=[a-f0-9]{40}&event=push&per_page=100)$/.test(path),'対象外API');
 try{const r=await request('https://api.github.com/repos/papettoTV/virtual_gamecenter/'+path,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000)});if(!r.ok){await r.body?.cancel();throw Error();}return await r.json();}catch{throw Error('developの証跡を読み取れません。応答・認証値は表示しません');}
 };
}
export function assertLiveApproval(p,x,run){
 need(p?.version===3&&p.mode===releaseMode&&JSON.stringify(p.execution)===JSON.stringify(x)
  &&p.protection?.preflightReady===true&&p.evidence?.runId===String(run),'別run・別SHA・鍵なし版の承認対象');
}
const receipt=e=>({candidate:e.sha,tree:e.tree,buildRun:e.runId,buildAttempt:e.attempt});
async function json(p){const b=await readFile(p);need(b.length<65536,'承認対象過大');return JSON.parse(b);}
async function outputs(e){await appendFile(process.env.GITHUB_OUTPUT,`build_run=${e.runId}\nartifact_id=${e.artifactId}\n`);}
async function main(){
 const x=executionContext(),api=postmergeApi(process.env.GH_TOKEN),run=process.env.CI_RUN_ID,mode=process.argv[2];
 if(mode==='prepare'){
  const protection=await verifyProtection(readApi(process.env.GH_TOKEN),x,{requireSnapshot:false});
  const evidence=await developEvidence(api,run,policy);await outputs(evidence);
  await writeFile('postmerge-preflight.json',JSON.stringify({execution:x,evidence,protection}));return;
 }
 if(mode==='freeze'){
  const p=await json('postmerge-preflight.json');need(JSON.stringify(p.execution)===JSON.stringify(x),'別実行の事前確認');
  const e=await developEvidence(api,run,policy);need(JSON.stringify(e)===JSON.stringify(p.evidence),'公開候補が変更');
  const files=await checkBuild('build',receipt(e)),digest=hash(await readFile('build/manifest.json'));
  releaseScope(e,x,digest);await writeFile('postmerge-approval.json',JSON.stringify({...p,version:3,mode:releaseMode,files,manifestDigest:digest}));
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## develop公開の承認対象（検証環境への実公開）\nSHA: ${e.sha}\nCI: ${e.runId}\n制御SHA: ${x.controlSha}\n\n承認後はpulbase-stagingとPages developへこのSHAを1回公開し、HTTPとブラウザ8件を1回確認します。検証用ゲストが作成されます。失敗時は修正PRで対応します。main・本番・Xは変更しません。\n`);return;
 }
 need(['approved-input','approved'].includes(mode),'不明なモード');
 const p=await json('postmerge-approval.json');assertLiveApproval(p,x,run);
 const approvedProtection=await verifyProtection(readApi(process.env.GH_TOKEN),x,{ruleVersions:process.env.PULBASE_CONTROL_RULE_VERSIONS});
 const e=await developEvidence(api,run,policy);need(JSON.stringify(e)===JSON.stringify(p.evidence),'古い承認対象');
 if(mode==='approved-input'){await outputs(e);return;}
 const files=await checkBuild('build',receipt(e));need(files===p.files&&hash(await readFile('build/manifest.json'))===p.manifestDigest,'成果物差替え');
 const scope=releaseScope(e,x,p.manifestDigest);
 const observe=async()=>{
  await verifyProtection(readApi(process.env.GH_TOKEN),x,{ruleVersions:process.env.PULBASE_CONTROL_RULE_VERSIONS});
  return developEvidence(api,run,policy);
 };
 let operations;
 try{
  operations=await connectedStagingOperations({mode:'live',scope,execution:x,artifactDirectory:'build',guard:observe,credentials:liveCredentials()});
  const result=await runPostmergeStaging({scope,execution:x,observe,publish:operations.publish,regress:operations.regress});
  await writeFile('postmerge-result.json',JSON.stringify({...result,mode:releaseMode,controlSha:x.controlSha,ciRunId:e.runId,filesVerified:files,
   protectionVerified:true,protectionMode:approvedProtection.protectionMode,...operations.report(),realMergeExecuted:false},null,2));
 }catch(error){error.sha=e.sha;error.operationStatus=operations?.report();throw error;}
}
export function failureReport(error){
 const s=error?.operationStatus??{},outcome=v=>['not-attempted','unknown','uploaded'].includes(v)?v:'not-attempted';
 return {status:'failed',mode:releaseMode,sha:/^[a-f0-9]{40}$/.test(error?.sha??'')?error.sha:null,
 phase:['before-publication','publication','regression'].includes(error?.phase)?error.phase:'evidence',recovery:'fix-pull-request',
 workerOutcome:outcome(s.workerOutcome),pagesOutcome:outcome(s.pagesOutcome),
 partialPublicationPossible:s.workerOutcome==='unknown'||s.pagesOutcome==='unknown'||(s.workerOutcome==='uploaded'&&s.pagesOutcome!=='uploaded')||(s.pagesOutcome==='uploaded'&&s.workerOutcome!=='uploaded'),
 realDeploymentExecuted:s.realDeploymentExecuted===true,realDeploymentAttempted:s.realDeploymentAttempted===true,
 realRegressionExecuted:s.realRegressionExecuted===true,regressionPassed:false,
 httpAttempted:s.httpAttempted===true,browserAttempted:s.browserAttempted===true,commandFailure:sanitizeCommandFailure(s.commandFailure),browserFailure:sanitizeBrowserFailure(s.browserFailure),
 publicationStopReason:PUBLICATION_STOP_REASONS.includes(s.publicationStopReason)?s.publicationStopReason:'unknown',
 realMergeExecuted:false,mainUpdated:false,productionRequested:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(async e=>{console.error(e.message);await writeFile('postmerge-result.json',JSON.stringify(failureReport(e),null,2));process.exitCode=1;});
