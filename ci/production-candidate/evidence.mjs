// Keyless candidate inspection only. No approval, promotion or deployment adapter.
import {createHash} from 'node:crypto';
import {developEvidence} from '../control/postmerge-staging.mjs';
import {trustPolicy} from '../control/review-trust.mjs';
const repo='papettoTV/virtual_gamecenter';
const sha=v=>/^[a-f0-9]{40}$/.test(v??'');
const id=v=>/^[1-9][0-9]*$/.test(String(v??''));
function need(v,m){if(!v)throw Error(m);}
export const digest=value=>createHash('sha256').update(value).digest('hex');
function list(value,key){need(Array.isArray(value?.[key])&&value.total_count===value[key].length&&value.total_count<100,'証跡一覧が不完全です');return value[key];}
function runIdentity(run,runId,path,branch,revision,now,policy){
 const at=Date.parse(run?.created_at),end=Date.parse(run?.updated_at);
 need(id(runId)&&String(run?.id)===String(runId)&&run.path===`.github/workflows/${path}.yml`
  &&run.head_branch===branch&&run.head_sha===revision&&run.head_repository?.full_name===repo
  &&run.run_attempt===1&&run.status==='completed'&&run.conclusion==='success'
  &&Number.isFinite(at)&&Number.isFinite(end)&&at<=end&&end<=now+30000&&at<=now
  &&now-at<=policy.maxAgeMs,'成功した初回実行・SHA・鮮度を確認できません');
}
async function jobs(api,runId,names){
 const values=list(await api(`actions/runs/${runId}/jobs?filter=latest&per_page=100`),'jobs');
 need(names.every(name=>values.filter(x=>x.name===name&&x.status==='completed'&&x.conclusion==='success').length===1),'必須ジョブが未合格です');
}
async function receipt(api,load,run,name,file){
 const artifacts=list(await api(`actions/runs/${run.id}/artifacts?per_page=100`),'artifacts');
 const matching=artifacts.filter(x=>x.name===`${name}-${run.id}-1`),a=matching[0];
 need(matching.length===1&&id(a.id)&&a.expired===false&&Number.isSafeInteger(a.size_in_bytes)
  &&a.size_in_bytes>0&&a.size_in_bytes<=1024*1024&&/^sha256:[a-f0-9]{64}$/.test(a.digest??'')
  &&a.workflow_run?.id===run.id&&a.workflow_run.head_sha===run.head_sha
  &&a.workflow_run.head_branch===run.head_branch,'証跡成果物の出所・digestが不一致です');
 const bytes=await load(String(a.id));
 need(Buffer.isBuffer(bytes)&&bytes.length===a.size_in_bytes&&`sha256:${digest(bytes)}`===a.digest,'証跡ZIPが差し替わっています');
 return {artifact:{id:String(a.id),digest:a.digest},file,bytes};
}
export async function productionCandidate({api,load,parse,stagingRunId,preparationRunId,policy,reviewPolicy,now=Date.now()}){
 need(policy?.version===1&&policy.repository===repo&&policy.mode==='keyless-only'&&policy.maxAgeMs===86400000
  &&sha(policy.controlSha)&&sha(policy.mainSha)&&policy.reviewPolicyDigest===trustPolicy(reviewPolicy)
  &&Object.keys(policy.preparationFiles??{}).length>=6&&Object.values(policy.preparationFiles).every(sha),'固定された候補検査定義が必要です');
 need(id(stagingRunId)&&id(preparationRunId)&&Number.isSafeInteger(now),'実行IDが不正です');
 const current=await api('git/ref/heads/develop'),revision=current.object?.sha;need(sha(revision),'develop SHA不正');
 need((await api('git/ref/heads/main')).object?.sha===policy.mainSha,'mainが準備開始時から変わっています');
 const controlSha=(await api('git/ref/heads/ci-control')).object?.sha;
 need(sha(controlSha)&&Object.keys(policy.controlFiles??{}).length===28&&Object.values(policy.controlFiles).every(sha),'制御コードの固定定義が不完全です');
 const controlTree=await api(`git/trees/${controlSha}?recursive=1`);
 need(controlTree.truncated===false&&Array.isArray(controlTree.tree)&&controlTree.tree.length<20000,'制御treeが不完全です');
 for(const [path,expected]of Object.entries(policy.controlFiles)){
  const items=controlTree.tree.filter(x=>x.path===path);
  need(items.length===1&&items[0].type==='blob'&&items[0].mode==='100644'&&items[0].sha===expected,'既存の保護された制御が変更されています: '+path);
 }
 const staging=await api(`actions/runs/${stagingRunId}`);
 const stagingControlSha=staging?.head_sha;
 need([policy.controlSha,controlSha].includes(stagingControlSha),'検証公開の制御SHAが固定版と不一致です');
 runIdentity(staging,stagingRunId,'postmerge-staging','ci-control',stagingControlSha,now,policy);
 need(staging.event==='workflow_dispatch','検証公開の起動元が不正です');
 await jobs(api,stagingRunId,['prepare','staging']);
 const approvalArchive=await receipt(api,load,staging,'postmerge-approval','postmerge-approval.json');
 const resultArchive=await receipt(api,load,staging,'postmerge-result','postmerge-result.json');
 const approval=await parse(approvalArchive.bytes,approvalArchive.file),result=await parse(resultArchive.bytes,resultArchive.file);
 const e=approval?.evidence,x=approval?.execution;
 need(approval.version===3&&approval.mode==='postmerge-staging-live'&&e?.sha===revision
  &&x?.repository===repo&&x.ref==='refs/heads/ci-control'&&x.event==='workflow_dispatch'&&x.environment==='staging'
  &&x.controlSha===stagingControlSha&&x.runId===String(stagingRunId)&&x.attempt==='1'
  &&/^[a-f0-9]{64}$/.test(approval.manifestDigest??'')&&Number.isSafeInteger(approval.files)&&approval.files>0,
 '検証承認対象のSHA・制御実行・成果物が不一致です');
 const build=await developEvidence(api,e.runId,reviewPolicy,now);
 need(JSON.stringify(build)===JSON.stringify(e),'検証公開と現在のCI・成果物が一致しません');
 need(Date.parse(staging.created_at)>=Date.parse((await api(`actions/runs/${e.runId}`)).updated_at),'CI完了前の検証公開を拒否します');
 need(result?.status==='passed'&&result.mode==='postmerge-staging-live'&&result.executionMode==='live'
  &&result.sha===revision&&result.controlSha===stagingControlSha&&result.ciRunId===e.runId&&result.filesVerified===approval.files
  &&result.approvalCount===1&&result.publicationCount===1&&result.regressionCount===1
  &&result.protectionVerified===true&&result.protectionMode==='strict'&&result.regressionPassed===true
  &&result.realDeploymentExecuted===true&&result.realRegressionExecuted===true
  &&result.httpAttempted===true&&result.browserAttempted===true&&result.browserTests===8
  &&result.workerOutcome==='uploaded'&&result.pagesOutcome==='uploaded'
  &&result.realDeploymentAttempted===true&&result.browserCommandValidated===true&&result.commandFailure===null&&result.publicationStopReason===null
  &&result.httpSimulated===false&&result.browserSimulated===false&&result.workerDryRunExecuted===false
  &&result.mainUpdated===false&&result.productionRequested===false&&result.realMergeExecuted===false,
 '実公開・strict・HTTP/ブラウザ回帰の成功証跡が不完全です');
 const prep=await api(`actions/runs/${preparationRunId}`);
 runIdentity(prep,preparationRunId,'production-preparation','develop',revision,now,policy);
 need(['push','workflow_dispatch'].includes(prep.event),'PRのマージ候補ビルドは本番候補に使えません');
 const preparations=list(await api(`actions/workflows/production-preparation.yml/runs?head_sha=${revision}&per_page=100`),'workflow_runs');
 const latest=preparations.filter(x=>x.head_sha===revision&&['push','workflow_dispatch'].includes(x.event)).sort((a,b)=>b.id-a.id)[0];
 need(latest?.id===prep.id&&latest.run_attempt===1&&latest.status==='completed'&&latest.conclusion==='success','最新の本番準備CI以外・再実行を拒否します');
 await jobs(api,preparationRunId,['prepare']);
 const tree=await api(`git/trees/${revision}?recursive=1`);
 need(tree.truncated===false&&Array.isArray(tree.tree)&&tree.tree.length<20000,'本番準備の定義treeが不完全です');
 for(const [path,expected]of Object.entries(policy.preparationFiles)){
  const items=tree.tree.filter(x=>x.path===path);need(items.length===1&&items[0].type==='blob'&&items[0].mode==='100644'&&items[0].sha===expected,'本番準備の定義が固定版と不一致です: '+path);
 }
 const prepArchive=await receipt(api,load,prep,'production-preparation','production-preparation.json');
 const p=await parse(prepArchive.bytes,prepArchive.file);
 need(p?.mode==='production-preparation-only'&&p.sourceSha===revision&&p.configurationPassed===true
  &&p.buildPassed===true&&p.workerDryRunPassed===true&&p.browserDefinitionsListed===true
  &&p.localMigration?.passed===true&&p.localMigration.remoteMigrationApplied===false
  &&p.productionReady===false&&p.mainUpdated===false&&p.deploymentRequested===false
  &&p.workerUploaded===false&&p.pagesUploaded===false&&p.remoteMigrationApplied===false&&p.realRegressionExecuted===false,
 '同じSHAの本番ビルド・ローカル移行・dry-runが不合格です');
 const compare=await api(`compare/${policy.mainSha}...${revision}`);
 need(compare.status==='ahead'&&compare.merge_base_commit?.sha===policy.mainSha,'mainからfast-forwardできる候補ではありません');
 // Recheck mutable identities after downloading all receipts. Never infer approval.
 need((await api('git/ref/heads/develop')).object?.sha===revision,'証跡照合中にdevelopが進みました');
 need((await api('git/ref/heads/main')).object?.sha===policy.mainSha
  &&(await api('git/ref/heads/ci-control')).object?.sha===controlSha,'証跡照合中にmain・制御SHAが変わりました');
 need(JSON.stringify(await developEvidence(api,e.runId,reviewPolicy,now))===JSON.stringify(build),'証跡照合中にCI・成果物が変わりました');
 for(const [runId,original]of [[stagingRunId,staging],[preparationRunId,prep]]){
  const again=await api(`actions/runs/${runId}`);need(again.run_attempt===1&&again.status==='completed'
   &&again.conclusion==='success'&&again.head_sha===original.head_sha,'証跡照合中の再実行・変更を拒否します');
 }
 const identity={sha:revision,tree:build.tree,mainSha:policy.mainSha,controlSha,stagingControlSha,
  ciRunId:e.runId,buildArtifactId:e.artifactId,manifestDigest:approval.manifestDigest,
  stagingRunId:String(stagingRunId),preparationRunId:String(preparationRunId),
  receipts:[approvalArchive.artifact,resultArchive.artifact,prepArchive.artifact]};
 return {version:1,mode:'production-candidate-keyless',evidencePassed:true,identity,
  fingerprint:digest(JSON.stringify(identity)),checkedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString(),
  productionReady:false,humanApprovalVerified:false,controlInstalled:false,
  mainUpdated:false,workerCreated:false,deploymentRequested:false,xPosted:false,
  plannedOrder:['人が同一SHAの本番リリースを承認','mainへ同一SHAを昇格','本番成果物を公開','公開後回帰を1回','成功後だけ手動投稿用文面を提示']};
}

// Data-only rehearsal: there is deliberately no callback or live mode.
export function simulateProductionRelease(plan,{humanApproval=false,observations=[],regression={},now=Date.now()}={}){
 need(plan?.mode==='production-candidate-keyless'&&plan.evidencePassed===true
  &&digest(JSON.stringify(plan.identity))===plan.fingerprint,'候補計画が差し替わっています');
 need(humanApproval===true&&Number.isSafeInteger(now)&&now>=Date.parse(plan.checkedAt)&&now<Date.parse(plan.expiresAt),'模擬承認なし・候補計画期限切れ');
 need(observations.length===3,'模擬の各処理直前の照合が必要です');
 const counts={simulatedApprovalCount:1,simulatedPromotionCount:0,simulatedPublicationCount:0,simulatedRegressionCount:0};
 const phases=[['promotion','simulatedPromotionCount'],['publication','simulatedPublicationCount'],['regression','simulatedRegressionCount']];
 for(const [index,[phase,key]]of phases.entries()){
  try{
   need(observations[index]===plan.fingerprint,'模擬承認後の候補変更を拒否します');
   counts[key]++;
   if(phase==='regression')need(regression.passed===true&&regression.sha===plan.identity.sha,'模擬回帰失敗。自動再試行・巻き戻しは行いません');
  }catch(error){error.phase=phase;error.simulatedCounts={...counts};throw error;}
 }
 return {mode:'simulation-only',...counts,manualAnnouncementPreviewOnly:true,
  mainUpdated:false,deploymentRequested:false,realRegressionExecuted:false,xPosted:false};
}
