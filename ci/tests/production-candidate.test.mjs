import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {productionCandidate,simulateProductionRelease,digest} from '../production-candidate/evidence.mjs';
import {candidateReader,readJsonArchive} from '../production-candidate/check.mjs';
import {trustPolicy} from '../control/review-trust.mjs';
const policy=JSON.parse(await readFile(new URL('../production-candidate/policy.json',import.meta.url),'utf8'));
const reviewPolicy=JSON.parse(await readFile(new URL('../control/review-trust.json',import.meta.url),'utf8'));
const now=Date.parse('2026-10-28T12:00:00Z'),revision='a'.repeat(40),treeSha='b'.repeat(40);
function fixture(){
 const run=(id,path,branch,head,event,age)=>({id,path:`.github/workflows/${path}.yml`,head_branch:branch,head_sha:head,event,
  head_repository:{full_name:policy.repository},run_attempt:1,status:'completed',conclusion:'success',
  created_at:new Date(now-age).toISOString(),updated_at:new Date(now-age+60000).toISOString()});
 const ci=run(100,'web-checks','develop',revision,'push',600000);
 const staging=run(200,'postmerge-staging','ci-control',policy.controlSha,'workflow_dispatch',300000);
 const prep=run(300,'production-preparation','develop',revision,'push',600000);
 const evidence={repository:policy.repository,environment:'staging',sha:revision,tree:treeSha,runId:'100',attempt:'1',artifactId:'99',policyDigest:trustPolicy(reviewPolicy)};
 const approval={version:3,mode:'postmerge-staging-live',evidence,files:114,manifestDigest:'c'.repeat(64),execution:{repository:policy.repository,
  ref:'refs/heads/ci-control',event:'workflow_dispatch',environment:'staging',controlSha:policy.controlSha,runId:'200',attempt:'1'}};
 const result={status:'passed',mode:'postmerge-staging-live',executionMode:'live',sha:revision,controlSha:policy.controlSha,ciRunId:'100',filesVerified:114,
  approvalCount:1,publicationCount:1,regressionCount:1,protectionVerified:true,protectionMode:'strict',regressionPassed:true,
  realDeploymentExecuted:true,realRegressionExecuted:true,httpAttempted:true,browserAttempted:true,browserTests:8,
  realDeploymentAttempted:true,browserCommandValidated:true,commandFailure:null,publicationStopReason:null,
  workerOutcome:'uploaded',pagesOutcome:'uploaded',httpSimulated:false,browserSimulated:false,workerDryRunExecuted:false,
  mainUpdated:false,productionRequested:false,realMergeExecuted:false};
 const preparation={mode:'production-preparation-only',sourceSha:revision,configurationPassed:true,buildPassed:true,workerDryRunPassed:true,
  browserDefinitionsListed:true,localMigration:{passed:true,remoteMigrationApplied:false},productionReady:false,
  mainUpdated:false,deploymentRequested:false,workerUploaded:false,pagesUploaded:false,remoteMigrationApplied:false,realRegressionExecuted:false};
 const data={
  'git/ref/heads/develop':{object:{sha:revision}},'git/ref/heads/main':{object:{sha:policy.mainSha}},'git/ref/heads/ci-control':{object:{sha:policy.controlSha}},
  'actions/runs/100':ci,'actions/runs/200':staging,'actions/runs/300':prep,
  [`actions/workflows/web-checks.yml/runs?head_sha=${revision}&event=push&per_page=100`]:{total_count:1,workflow_runs:[ci]},
  [`actions/workflows/production-preparation.yml/runs?head_sha=${revision}&per_page=100`]:{total_count:1,workflow_runs:[prep]},
  [`git/commits/${revision}`]:{tree:{sha:treeSha}},
  [`git/trees/${revision}?recursive=1`]:{truncated:false,tree:Object.entries({...reviewPolicy.files,...policy.preparationFiles})
   .map(([path,sha])=>({path,sha,mode:'100644',type:'blob'}))},
  [`compare/${policy.mainSha}...${revision}`]:{status:'ahead',merge_base_commit:{sha:policy.mainSha}},
 };
 for(const [runId,names]of [[100,['verify','Automation control checks']],[200,['prepare','staging']],[300,['prepare']]]){
  data[`actions/runs/${runId}/jobs?filter=latest&per_page=100`]={total_count:names.length,jobs:names.map(name=>({name,status:'completed',conclusion:'success'}))};
 }
 data['actions/runs/100/artifacts?per_page=100']={total_count:1,artifacts:[{id:99,name:`staging-build-${revision}-1`,expired:false,size_in_bytes:10,workflow_run:{id:100,head_sha:revision}}]};
 const bytes={};
 function refresh(){
  for(const [r,entries]of [[staging,[[201,'postmerge-approval',approval],[202,'postmerge-result',result]]],[prep,[[301,'production-preparation',preparation]]]]){
   const artifacts=entries.map(([id,name,document])=>{bytes[id]=Buffer.from(JSON.stringify(document));return {id,name:`${name}-${r.id}-1`,expired:false,
    size_in_bytes:bytes[id].length,digest:`sha256:${digest(bytes[id])}`,workflow_run:{id:r.id,head_sha:r.head_sha,head_branch:r.head_branch}};});
   data[`actions/runs/${r.id}/artifacts?per_page=100`]={total_count:artifacts.length,artifacts};
  }
 }
 refresh();
 return {data,bytes,approval,result,preparation,refresh,options:{api:async path=>{assert.ok(path in data,`Unexpected GET: ${path}`);return data[path];},
  load:async id=>bytes[id],parse:async b=>JSON.parse(b.toString()),stagingRunId:'200',preparationRunId:'300',policy,reviewPolicy,now}};
}
test('同一SHAの実検証・本番ビルドから候補を照合しても承認や公開可能とは判定しない',async()=>{
 const f=fixture(),plan=await productionCandidate(f.options);assert.equal(plan.evidencePassed,true);assert.equal(plan.identity.sha,revision);
 for(const field of ['productionReady','humanApprovalVerified','controlInstalled','mainUpdated','workerCreated','deploymentRequested','xPosted'])assert.equal(plan[field],false);
 const simulation=simulateProductionRelease(plan,{humanApproval:true,observations:Array(3).fill(plan.fingerprint),regression:{passed:true,sha:revision},now});
 assert.equal(simulation.simulatedApprovalCount,1);assert.equal(simulation.simulatedPublicationCount,1);assert.equal(simulation.simulatedRegressionCount,1);
 assert.equal(simulation.deploymentRequested,false);assert.equal(simulation.realRegressionExecuted,false);
});
test('古い候補・再実行・他リポジトリ・別制御SHA・CI失敗・PRビルドを拒否する',async()=>{
 for(const change of [
  f=>{f.data['git/ref/heads/develop'].object.sha='d'.repeat(40);},
  f=>{f.data['actions/runs/200'].run_attempt=2;},
  f=>{f.data['actions/runs/300'].event='pull_request';},
  f=>{f.data['actions/runs/300'].head_repository.full_name='attacker/repo';},
  f=>{f.data['actions/runs/200'].head_sha='d'.repeat(40);},
  f=>{f.data['actions/runs/200'].created_at=new Date(now-86400001).toISOString();},
  f=>{f.data['actions/runs/100'].conclusion='failure';},
  f=>{const d=f.data[`actions/workflows/production-preparation.yml/runs?head_sha=${revision}&per_page=100`];d.workflow_runs.push({...d.workflow_runs[0],id:400,conclusion:'failure'});d.total_count++;},
  f=>{f.data['actions/runs/200/jobs?filter=latest&per_page=100'].jobs.pop();},
  f=>{f.data[`compare/${policy.mainSha}...${revision}`].status='diverged';},
 ]){const f=fixture();change(f);await assert.rejects(productionCandidate(f.options));}
});
test('鍵なし模擬結果・strict以外・回帰欠落・別CIの証跡を拒否する',async()=>{
 for(const change of [
  f=>{f.result.httpSimulated=true;},f=>{f.result.realRegressionExecuted=false;},f=>{f.result.protectionMode='construction';},
  f=>{f.result.browserTests=7;},f=>{f.result.ciRunId='101';},f=>{f.result.publicationCount=2;},
  f=>{f.preparation.sourceSha='d'.repeat(40);},f=>{f.preparation.workerDryRunPassed=false;},
  f=>{f.approval.manifestDigest='bad';},f=>{f.approval.evidence.artifactId='98';},
 ]){const f=fixture();change(f);f.refresh();await assert.rejects(productionCandidate(f.options));}
});
test('ZIP差し替え・期限切れ・重複・不完全一覧・固定コードの変更を拒否する',async()=>{
 for(const change of [
  f=>{f.bytes[202]=Buffer.from('changed');},
  f=>{f.data['actions/runs/200/artifacts?per_page=100'].artifacts[0].expired=true;},
  f=>{const d=f.data['actions/runs/200/artifacts?per_page=100'];d.artifacts.push(d.artifacts[0]);d.total_count++;},
  f=>{f.data['actions/runs/300/artifacts?per_page=100'].total_count=2;},
  f=>{f.data[`git/trees/${revision}?recursive=1`].tree.find(x=>x.path==='ci/production-preparation.mjs').sha='d'.repeat(40);},
 ]){const f=fixture();change(f);await assert.rejects(productionCandidate(f.options));}
});
test('読取中のdevelop移動・再実行を最後に再照合して拒否する',async()=>{
 const f=fixture(),base=f.options.api;let reads=0;
 f.options.api=async path=>{if(path==='git/ref/heads/develop'&&++reads===2)return {object:{sha:'d'.repeat(40)}};return base(path);};
 await assert.rejects(productionCandidate(f.options));
 const g=fixture(),api=g.options.api;let calls=0;
 g.options.api=async path=>{if(path==='actions/runs/200'&&++calls===2)return {...g.data[path],run_attempt:2};return api(path);};
 await assert.rejects(productionCandidate(g.options));
});
test('模擬承認なし・承認後の差し替え・期限切れ・回帰失敗は成功文面へ進めない',async()=>{
 const plan=await productionCandidate(fixture().options),valid={humanApproval:true,observations:Array(3).fill(plan.fingerprint),regression:{passed:true,sha:revision},now};
 for(const options of [{...valid,humanApproval:false},{...valid,observations:['changed']},{...valid,now:now+3600000},{...valid,regression:{passed:false,sha:revision}}])assert.throws(()=>simulateProductionRelease(plan,options));
 const changed=structuredClone(plan);changed.identity.sha='d'.repeat(40);assert.throws(()=>simulateProductionRelease(changed,valid));
 assert.throws(()=>simulateProductionRelease(plan,{...valid,observations:[plan.fingerprint,'changed',plan.fingerprint]}),
  error=>error.phase==='publication'&&error.simulatedCounts.simulatedPromotionCount===1&&error.simulatedCounts.simulatedPublicationCount===0);
 assert.throws(()=>simulateProductionRelease(plan,{...valid,regression:{passed:false,sha:revision}}),
  error=>error.phase==='regression'&&error.simulatedCounts.simulatedPublicationCount===1&&error.simulatedCounts.simulatedRegressionCount===1);
});
test('候補検査の通信は固定GitHubのGETのみ、任意エンドポイントやURLを拒否する',async()=>{
 const calls=[],reader=candidateReader(args=>{calls.push(args);return Buffer.from('{}');});
 await reader.api('actions/runs/200');await reader.load('201');
 await assert.rejects(reader.api('actions/workflows/x.yml/dispatches'));await assert.rejects(reader.api('https://example.com'));await assert.rejects(reader.load('../201'));
 assert.equal(calls.length,2);for(const args of calls){assert.deepEqual(args.slice(0,3),['api','--method','GET']);assert.ok(args[3].startsWith('repos/papettoTV/virtual_gamecenter/'));}
});
test('実ZIPを展開せずJSONだけを読む',()=>{
 const bytes=execFileSync('python3',['-c','import io,zipfile,sys; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); z.writestr("postmerge-result.json",\'{"passed":true}\'); z.close(); sys.stdout.buffer.write(b.getvalue())']);
 assert.deepEqual(readJsonArchive(bytes,'postmerge-result.json'),{passed:true});assert.throws(()=>readJsonArchive(bytes,'script.sh'));
});
test('固定された本番準備ファイルのblobを現在のソースと照合する',()=>{
 for(const [path,expected]of Object.entries(policy.preparationFiles))assert.equal(execFileSync('git',['hash-object',path],{encoding:'utf8',cwd:fileURLToPath(new URL('../../',import.meta.url))}).trim(),expected,path);
});
