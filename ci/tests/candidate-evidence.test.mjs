import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execution, liveEvidence, apiRead, receiptArtifact } from '../control/candidate-evidence.mjs';
import { reviewReceipt } from '../review-receipt.mjs';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
const head='a'.repeat(40), base='b'.repeat(40), candidate='c'.repeat(40), tree='d'.repeat(40), repo='papettoTV/virtual_gamecenter';
function fixture() {
 const r={version:1,repository:repo,pullNumber:'8',head,base,candidate,tree,reviewRun:'20',reviewAttempt:'1',buildRun:'10',buildAttempt:'1',buildArtifact:'30',pass:true,findings:[]};
 const run=(workflow,id)=>({id,run_attempt:1,status:'completed',conclusion:'success',head_sha:head,event:'pull_request',path:`.github/workflows/${workflow}.yml`,head_repository:{full_name:repo}});
 const review=run('codex-pr',20), build=run('web-checks',10);
 const pr={state:'open',draft:false,user:{login:'pulbase-codex[bot]'},base:{ref:'develop',sha:base,repo:{full_name:repo}},head:{sha:head,ref:'codex/issue-7',repo:{full_name:repo}},merge_commit_sha:candidate};
 const a={id:30,name:`staging-build-${candidate}-1`,expired:false,size_in_bytes:200,workflow_run:{id:10,head_sha:head}};
 const api=async p=>{
 if(p==='pulls/8')return pr;
 if(p==='issues/7')return {state:'open',labels:[{name:'実装:自動'},{name:'検証:公開なし'}]};
 if(p==='git/ref/heads/develop')return {object:{sha:base}};
 if(p===`git/commits/${candidate}`)return {tree:{sha:tree},parents:[{sha:base},{sha:head}]};
 if(p==='actions/runs/20')return review;
 if(p.includes('/runs?'))return {total_count:1,workflow_runs:[p.includes('codex-pr')?review:build]};
 if(p.includes('/jobs?')){const names=p.startsWith('actions/runs/20/')?['gate','Candidate tests','review','review-gate']:['verify','Automation control checks'];return {total_count:names.length,jobs:names.map(name=>({name,status:'completed',conclusion:'success'}))};}
 if(p==='actions/runs/10/artifacts?per_page=100')return {total_count:1,artifacts:[a]};
 throw Error('unexpected '+p);
 };
 return {r,api,pr,review,build,a};
}
test('現在の同じPR・候補・初回CI・Codexレビューの証跡だけを受理',async()=>{const f=fixture();assert.equal((await liveEvidence(f.api,f.r,'20')).artifactId,'30');});
test('古いhead/base/candidateとレビュー偽装・別run・再実行を拒否',async()=>{
 for(const change of [{head:base},{base:head},{candidate:head},{pass:false},{findings:['指摘']},{reviewRun:'21'},{reviewAttempt:'2'},{buildAttempt:'2'}]){const f=fixture();await assert.rejects(liveEvidence(f.api,{...f.r,...change},'20'));}
});
test('最新CI失敗・再実行・成果物出所や期限の違いを拒否',async()=>{
 for(const mutate of [f=>f.build.conclusion='failure',f=>f.build.run_attempt=2,f=>f.review.run_attempt=2,f=>f.a.expired=true,f=>f.a.workflow_run.head_sha=base,f=>f.pr.state='closed']){const f=fixture();mutate(f);await assert.rejects(liveEvidence(f.api,f.r,'20'));}
});
test('workflow_run初回以外の実行・別ブランチを拒否',()=>{
 const env={GITHUB_REPOSITORY:repo,GITHUB_REF:'refs/heads/develop',GITHUB_EVENT_NAME:'workflow_run',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:head,GITHUB_RUN_ID:'42'};
 execution(env);for(const change of [{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_REF:'refs/heads/main'},{GITHUB_EVENT_NAME:'workflow_dispatch'}])assert.throws(()=>execution({...env,...change}));
});
test('APIは固定repoへのGETのみでエラー応答を漏らさない',async()=>{
 let calls=0;const api=apiRead('test',async(url,opts)=>{calls++;assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');return new Response('secret',{status:403});});
 await assert.rejects(api('pulls/8'),e=>!e.message.includes('secret'));await assert.rejects(api('actions/workflows/x/dispatches'));assert.equal(calls,1);
});
test('証跡のないレビューrunを成功扱いしない',async()=>{const f=fixture();await assert.rejects(receiptArtifact(async p=>p.includes('artifacts')?{total_count:0,artifacts:[]}:f.api(p),'20'));});
test('レビューreceiptは初回合格のみで、SHAとCIを固定する',()=>{
 const env={GITHUB_REPOSITORY:repo,PR_NUMBER:'8',PR_HEAD:head,PR_BASE:base,PR_CANDIDATE:candidate,PR_TREE:tree,GITHUB_RUN_ID:'20',GITHUB_RUN_ATTEMPT:'1',BUILD_RUN_ID:'10',BUILD_ATTEMPT:'1',BUILD_ARTIFACT_ID:'30',REVIEW_RESULT:'{"pass":true,"findings":[]}'};
 assert.equal(reviewReceipt(env).candidate,candidate);assert.throws(()=>reviewReceipt({...env,REVIEW_RESULT:'{"pass":false,"findings":[]}'}));assert.throws(()=>reviewReceipt({...env,GITHUB_RUN_ATTEMPT:'2'}));
});
test('自動検証workflowはSecret・Environment・書込権限・候補実行を持たない',async()=>{
 const text=await readFile(new URL('../../.github/workflows/candidate-evidence.yml',import.meta.url),'utf8'),w=parse(text);
 assert.deepEqual(w.permissions,{contents:'read',actions:'read'});assert.equal(w.jobs.evidence.environment,undefined);assert.ok(!text.includes('secrets.'));assert.deepEqual(w.on.workflow_run.workflows,['Codex PR verification']);
 assert.equal(w.jobs.evidence.steps[0].with.ref,'${{ github.sha }}');assert.ok(!/npm |deploy|dispatches/.test(text));
 const review=parse(await readFile(new URL('../../.github/workflows/codex-pr.yml',import.meta.url),'utf8'));
 assert.equal(review.jobs.staging,undefined);assert.equal(review.jobs.merge,undefined);
});
test('実成果物のSHA刻印と全ファイルハッシュを検査し改変・リンクを拒否',async()=>{
 const {mkdtemp,mkdir,writeFile,symlink,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {createHash}=await import('node:crypto');const {checkBuild}=await import('../control/candidate-evidence.mjs');
 const dir=await mkdtemp(join(tmpdir(),'evidence-'));try{
 await mkdir(join(dir,'worker'));await mkdir(join(dir,'client'));
 const content=`// revision ${candidate}`,files={};
 for(const path of ['worker/index.js','client/_worker.js']){await writeFile(join(dir,path),content);files[path]=createHash('sha256').update(content).digest('hex');}
 const f=fixture();await writeFile(join(dir,'manifest.json'),JSON.stringify({version:1,environment:'staging',sha:candidate,tree,runId:'10',attempt:'1',files}));
 assert.equal(await checkBuild(dir,f.r),2);await writeFile(join(dir,'worker/index.js'),'changed');await assert.rejects(checkBuild(dir,f.r));
 await rm(join(dir,'worker/index.js'));await symlink(join(dir,'client/_worker.js'),join(dir,'worker/index.js'));await assert.rejects(checkBuild(dir,f.r));
 }finally{await rm(dir,{recursive:true,force:true});}
});
