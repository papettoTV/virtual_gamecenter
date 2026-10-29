import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
import {context,mergeTransport,performAutoMerge,readReceipt,CONTROL_SHA,RULE_VERSIONS,failureReport} from '../develop-auto-merge.mjs';
import {mergeReviewedCandidate} from '../control/develop-merge.mjs';
const head='a'.repeat(40),base='b'.repeat(40),tree='c'.repeat(40),merged='d'.repeat(40);
const env={GITHUB_REPOSITORY:'papettoTV/virtual_gamecenter',GITHUB_REF:'refs/heads/develop',GITHUB_EVENT_NAME:'workflow_run',GITHUB_RUN_ATTEMPT:'1',SOURCE_ATTEMPT:'1',GITHUB_RUN_ID:'100',REVIEW_RUN_ID:'90',GITHUB_SHA:base,PULBASE_CODEX_ENABLED:'true',PULBASE_DEVELOP_AUTO_MERGE_ENABLED:'true',EXPECTED_CONTROL_SHA:CONTROL_SHA};
test('developの初回レビュー完了イベント・専用フラグ・固定制御SHAを必須にする',()=>{
 assert.equal(context(env).environment,'automation');
 assert.throws(()=>context({...env,EXPECTED_CONTROL_SHA:'2c883a1cdd961510a0557742f74294739752f445'}));
 for(const patch of [{GITHUB_REF:'refs/heads/main'},{GITHUB_REF:'refs/heads/ci-control'},{GITHUB_EVENT_NAME:'workflow_dispatch'},{GITHUB_RUN_ATTEMPT:'2'},{SOURCE_ATTEMPT:'2'},{PULBASE_DEVELOP_AUTO_MERGE_ENABLED:'false'},{EXPECTED_CONTROL_SHA:head},{REVIEW_RUN_ID:'90\nanything'}])assert.throws(()=>context({...env,...patch}));
});
test('書込transportは同じPR・headのsquashだけを許し、main更新・dispatch・別PR・forceを拒否する',async()=>{
 let calls=0;
 const api=mergeTransport('dummy-key',{pullNumber:'8',head},async(url,options)=>{calls++;assert.equal(url,'https://api.github.com/repos/papettoTV/virtual_gamecenter/pulls/8/merge');assert.equal(options.redirect,'error');return new Response(JSON.stringify({merged:true,sha:merged}));});
 for(const [method,path,body] of [['PATCH','git/refs/heads/main',{sha:head}],['POST','actions/workflows/postmerge-staging.yml/dispatches',{}],['PUT','pulls/9/merge',{sha:head,merge_method:'squash'}],['PUT','pulls/8/merge',{sha:base,merge_method:'squash'}],['PUT','pulls/8/merge',{sha:head,merge_method:'merge'}],['GET','https://attacker.test'],['GET','git/ref/heads/main'],['POST','pulls/8/merge',{}]])await assert.rejects(api(method,path,body));
 assert.equal(calls,0);await api('PUT','pulls/8/merge',{sha:head,merge_method:'squash'});assert.equal(calls,1);
 const bad=mergeTransport('dummy-key',{pullNumber:'8',head},async()=>new Response('dummy-key-private-response',{status:403}));
 await assert.rejects(bad('GET','branches/develop/protection'),e=>!e.message.includes('dummy-key'));
});
function fixture(){
 let checks=0,puts=0,afterFailure=false;
 const control={protectionApi:async()=>{},verifyProtection:async(_a,_x,options)=>{assert.deepEqual(JSON.parse(options.ruleVersions),RULE_VERSIONS);if(afterFailure)throw Error('changed');return {protectionVerified:true,protectionMode:'strict'};},
 premergeDecision:async()=>{checks++;return {eligible:true,pullNumber:'8',head,base,tree,reviewTrust:{reviewTrustVerified:true}};},mergeReviewedCandidate};
 const write=()=>async(method,path)=>{
  if(method==='PUT'){puts++;return {merged:true,sha:merged};}
  if(path==='branches/develop/protection')return {enforce_admins:{enabled:true},required_status_checks:{strict:true,checks:['verify','Automation control checks'].map(context=>({context,app_id:15368}))}};
  if(path===`git/commits/${merged}`)return {tree:{sha:tree},parents:[{sha:base}]};
  if(path==='git/ref/heads/develop')return {object:{sha:merged}};
  throw Error('unexpected');
 };
 return {control,write,checks:()=>checks,puts:()=>puts,failAfter:()=>{const original=write();return ()=>async(...args)=>{const value=await original(...args);if(args[1]==='git/ref/heads/develop')afterFailure=true;return value;};}};
}
const execute=f=>performAutoMerge({receipt:{reviewRun:'90'},execution:context(env),api:async()=>{},policy:{},control:f.control,write:f.write});
test('保護側マージ処理で直前までCI・レビューを再照合し、AppによるPUTは1回だけ',async()=>{
 const f=fixture(),result=await execute(f);assert.equal(result.realMergeExecuted,true);assert.equal(result.protectionMode,'strict');assert.equal(result.sha,merged);assert.equal(f.puts(),1);assert.equal(f.checks(),3);assert.equal(result.productionRequested,false);
});
test('保護・レビュー失敗や処理中の候補変更は書込前に停止する',async()=>{
 for(const at of [1,2,3]){
  const f=fixture();let n=0;const original=f.control.premergeDecision;
  f.control.premergeDecision=async(...args)=>{if(++n===at)throw Error('stale head/base/review');return original(...args);};
  await assert.rejects(execute(f));assert.equal(f.puts(),0);
 }
 const f=fixture();f.control.verifyProtection=async()=>({protectionVerified:true,protectionMode:'construction'});await assert.rejects(execute(f));assert.equal(f.puts(),0);
});
test('マージ後の保護変更は実マージSHAを保持して未検証と報告し、再PUTしない',async()=>{
 const f=fixture();f.write=f.failAfter();await assert.rejects(execute(f),e=>e.outcome==='merged-unverified'&&e.mergedSha===merged);assert.equal(f.puts(),1);
});
test('証跡ファイルの追加・シンボリックリンク・過大サイズを拒否する',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'merge-receipt-'));try{
  await writeFile(join(dir,'review-receipt.json'),'{}');assert.deepEqual(await readReceipt(dir),{});
  await writeFile(join(dir,'extra'),'x');await assert.rejects(readReceipt(dir));await rm(join(dir,'extra'));
  await writeFile(join(dir,'review-receipt.json'),'x'.repeat(65536));await assert.rejects(readReceipt(dir));await rm(join(dir,'review-receipt.json'));
  await symlink('/does-not-exist',join(dir,'review-receipt.json'));await assert.rejects(readReceipt(dir));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('自動マージworkflowは候補コードをcheckoutせず、開発用鍵だけをautomationで使う',async()=>{
 const raw=await readFile(new URL('../../.github/workflows/develop-auto-merge.yml',import.meta.url),'utf8'),w=parse(raw);
 assert.deepEqual(w.permissions,{contents:'read',actions:'read'});assert.deepEqual(w.on.workflow_run.workflows,['Codex PR verification']);assert.equal(w.jobs.merge.environment,'automation');
 assert.ok(w.jobs.locate.if.includes('PULBASE_DEVELOP_AUTO_MERGE_ENABLED'));assert.ok(!/CLOUDFLARE|PULBASE_RELEASE_APP|OPENAI_API_KEY|environment: staging|pull_request_target/.test(raw));
 for(const job of Object.values(w.jobs))for(const step of job.steps){
  if(step.uses)assert.match(step.uses,/@[a-f0-9]{40}$/);
  if(step.uses?.startsWith('actions/checkout@'))assert.ok([CONTROL_SHA,'${{ github.sha }}'].includes(step.with.ref));
 }
 const token=w.jobs.merge.steps.find(s=>s.uses?.startsWith('actions/create-github-app-token@'));assert.equal(token.with['app-id'],'5403155');assert.equal(token.with.repositories,'virtual_gamecenter');
});

test('固定された実モジュールを接続し、現在の自動Issue・CI・レビューから実マージ応答まで照合する',async()=>{
 const {premergeDecision}=await import('../control/premerge-decision.mjs');
 const {verifyProtection}=await import('../control/protection-check.mjs');
 const policy=JSON.parse(await readFile(new URL('../control/review-trust.json',import.meta.url),'utf8'));
 const repo='papettoTV/virtual_gamecenter',url=`https://api.github.com/repos/${repo}`,candidate='e'.repeat(40),at='2026-10-27T00:00:00Z';
 for(const variant of ['valid','manual','evidence-only','changed-definition','stale-head','failed-review']){
  let puts=0;
  const receipt={version:1,repository:repo,pullNumber:'8',head,base,candidate,tree,reviewRun:'90',reviewAttempt:'1',buildRun:'80',buildAttempt:'1',buildArtifact:'70',pass:true,findings:[]};
  const run=(id,workflow)=>({id,run_attempt:1,status:'completed',conclusion:'success',head_sha:head,event:'pull_request',path:`.github/workflows/${workflow}.yml`,head_repository:{full_name:repo},created_at:at,pull_requests:[{number:8,base:{ref:'develop',sha:base,repo:{url}},head:{sha:head,repo:{url}}}]});
  const review=run(90,'codex-pr'),build=run(80,'web-checks');if(variant==='failed-review')review.conclusion='failure';
  const api=async path=>{
   if(path==='pulls/8')return {state:'open',draft:false,user:{login:'pulbase-codex[bot]'},base:{ref:'develop',sha:base,repo:{full_name:repo}},head:{sha:variant==='stale-head'?merged:head,ref:'codex/issue-7',repo:{full_name:repo}},merge_commit_sha:candidate};
   if(path==='issues/7')return {state:'open',labels:variant==='manual'?['実装:手元']:variant==='evidence-only'?['実装:自動','検証:公開なし']:['実装:自動']};
   if(path==='git/ref/heads/develop')return {object:{sha:base}};
   if(path===`git/commits/${candidate}`)return {tree:{sha:tree},parents:[{sha:base},{sha:head}]};
   if(path==='actions/runs/90')return review;if(path==='actions/runs/80')return build;
   if(path.includes('/runs?'))return {total_count:1,workflow_runs:[path.includes('codex-pr')?review:build]};
   if(path.includes('/jobs?')){const names=path.includes('/90/')?['gate','Candidate tests','review','review-gate']:['verify','Automation control checks'];return {total_count:names.length,jobs:names.map(name=>({name,status:'completed',conclusion:'success'}))};}
   if(path==='actions/runs/80/artifacts?per_page=100')return {total_count:1,artifacts:[{id:70,name:`staging-build-${candidate}-1`,expired:false,size_in_bytes:100,workflow_run:{id:80,head_sha:head}}]};
   if(path.startsWith('git/trees/'))return {truncated:false,tree:Object.entries(policy.files).map(([path,sha])=>({path,sha:variant==='changed-definition'&&path==='ci/prompts/review.md'?merged:sha,type:'blob',mode:'100644'}))};
   throw Error('unexpected '+path);
  };
  const protectionApi=async path=>{
   if(path==='environments/staging')return {can_admins_bypass:false,deployment_branch_policy:{protected_branches:false,custom_branch_policies:true},protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{login:'papettoTV'}}]}]};
   if(path.startsWith('environments/staging/deployment-branch'))return {total_count:1,branch_policies:[{name:'ci-control',type:'branch'}]};
   if(path==='rulesets?per_page=100')return [{id:1,name:'ci-control-human-managed'},{id:2,name:'main-release-app-only'}];
   if(path==='rulesets/1')return {enforcement:'active',target:'branch',bypass_actors:[],updated_at:RULE_VERSIONS.ciControl,conditions:{ref_name:{include:['refs/heads/ci-control'],exclude:[]}},rules:['creation','update','deletion','non_fast_forward'].map(type=>({type}))};
   if(path==='rulesets/2')return {enforcement:'active',target:'branch',bypass_actors:[],updated_at:RULE_VERSIONS.main,conditions:{ref_name:{include:['refs/heads/main'],exclude:[]}},rules:[{type:'update'}]};
   if(path==='git/ref/heads/main')return {object:{sha:'73cb5d9267c56f06f9f1150327ec6b8b3caa2bb9'}};
   if(path==='git/ref/heads/ci-control')return {object:{sha:CONTROL_SHA}};
   throw Error('unexpected protection '+path);
  };
  const write=()=>async(method,path)=>{
   if(method==='PUT'){puts++;return {merged:true,sha:merged};}
   if(path==='branches/develop/protection')return {enforce_admins:{enabled:true},required_status_checks:{strict:true,checks:['verify','Automation control checks'].map(context=>({context,app_id:15368}))}};
   if(path===`git/commits/${merged}`)return {tree:{sha:tree},parents:[{sha:base}]};
   if(path==='git/ref/heads/develop')return {object:{sha:merged}};
   throw Error('unexpected App '+path);
  };
  const invoke=()=>performAutoMerge({receipt,api,write,execution:context(env),control:{premergeDecision,mergeReviewedCandidate,verifyProtection,protectionApi},policy,now:()=>Date.parse(at)+1000});
  if(variant==='valid'){const result=await invoke();assert.equal(result.sha,merged);assert.equal(puts,1);}
  else{await assert.rejects(invoke());assert.equal(puts,0,variant);}
 }
});


test('失敗結果は停止段階と固定理由だけを保存し、認証・応答や任意文字列を含めない',()=>{
 const error=Object.assign(Error('dummy-secret 固定版と不一致: private-response'),{failureStage:'evidence'});
 const result=failureReport(error);assert.equal(result.stopReason,'definition-changed');assert.equal(result.failureStage,'evidence');assert.ok(!JSON.stringify(result).includes('dummy-secret'));assert.ok(!JSON.stringify(result).includes('private-response'));
});
