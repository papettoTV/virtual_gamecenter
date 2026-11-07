import {test} from 'node:test';import assert from 'node:assert/strict';
import {coordinateRepair,repairBatch} from '../automatic-repair.mjs';import {marker} from '../repair-ticket.mjs';
const repo={owner:'papettoTV',repo:'virtual_gamecenter'},repository='papettoTV/virtual_gamecenter',base='a'.repeat(40),head='b'.repeat(40),bot='pulbase-codex[bot]';
function fixture(){
 const issue={state:'open',labels:['実装:自動']},pr={number:125,user:{login:bot},state:'open',draft:false,mergeable:false,base:{ref:'develop',sha:'c'.repeat(40),repo:{full_name:repository}},head:{ref:'codex/issue-124',sha:head,repo:{full_name:repository}}};
 const comments=[],notices=[],sent=[];const list=()=>{},files=()=>{};
 const github={paginate:async m=>m===list?[pr]:[{filename:'apps/web/src/game.ts'}],rest:{pulls:{list,listFiles:files,get:async()=>({data:pr})},issues:{get:async()=>({data:issue}),listComments:async()=>({data:comments})},repos:{getBranch:async()=>({data:{commit:{sha:base}}})}}};
 const options={github,repo,eventName:'workflow_run',event:{workflow_run:{id:41500000001,path:'.github/workflows/web-checks.yml',event:'pull_request',run_attempt:1,conclusion:'failure',head_repository:{full_name:repository},head_branch:'codex/issue-124',head_sha:head}},runId:41500000002,bot,diagnostics:async()=>({ready:true,failed:true,entries:[{kind:'ui',message:'isMobile is not defined'}]}),notify:async(n,body)=>{notices.push({n,body});comments.push({user:{login:'github-actions[bot]',type:'Bot'},body});return{id:6590000000};},dispatch:async input=>sent.push(input)};
 return {options,issue,pr,comments,notices,sent};
}
test('競合中でも同じPRの診断ticketを作り、既存workflowへ修正を依頼する',async()=>{
 const f=fixture(),r=await coordinateRepair(f.options);assert.equal(r.status,'dispatched');assert.equal(r.pull,125);assert.equal(f.sent.length,1);assert.deepEqual(f.sent[0],{issue:'124',resume:true,repair_ticket:'6590000000'});assert.ok(f.notices[0].body.includes('isMobile is not defined'));
 const duplicate=await coordinateRepair(f.options);assert.equal(duplicate.reason,'duplicate-snapshot');assert.equal(f.sent.length,1);
});
test('古いhead・fork・別workflow・再実行runでは修正を起動しない',async()=>{
 for(const change of [e=>e.head_sha=base,e=>e.head_repository.full_name='attacker/repo',e=>e.path='.github/workflows/unknown.yml',e=>e.run_attempt=2]){
  const f=fixture();change(f.options.event.workflow_run);const r=await coordinateRepair(f.options);assert.equal(r.status,'ignored');assert.equal(f.sent.length,0);
 }
});
test('担当変更・保護ファイル・重複PRはdispatch前に拒否',async()=>{
 for(const change of [f=>f.issue.labels=['実装:手元'],f=>f.pr.user.login='someone',f=>{const list=f.options.github.rest.pulls.list;f.options.github.paginate=async m=>m===list?[f.pr]:[{filename:'ci/policy.mjs'}];},f=>{const list=f.options.github.rest.pulls.list;f.options.github.paginate=async m=>m===list?[f.pr,{...f.pr,number:126}]:[{filename:'apps/web/src/app.ts'}];}]){
  const f=fixture();change(f);await assert.rejects(coordinateRepair(f.options));assert.equal(f.sent.length,0);
 }
});
test('上限到達・診断なし・進行中のCIを区別し、通知を重複しない',async()=>{
 const f=fixture();for(let i=0;i<3;i++)f.comments.push({user:{login:'github-actions[bot]',type:'Bot'},body:`<!-- ${marker} ${JSON.stringify({version:1,issue:124,pull:125,head:String(i).repeat(40),base,round:i+1,dispatcherRun:41500000002,diagnostics:[]})} -->\n開始`});
 assert.equal((await coordinateRepair(f.options)).reason,'repair-limit');assert.equal(f.notices.length,1);await coordinateRepair(f.options);assert.equal(f.notices.length,1);assert.equal(f.sent.length,0);
 const g=fixture();g.pr.base.sha=base;g.pr.mergeable=true;g.options.diagnostics=async()=>({ready:true,failed:true,entries:[]});assert.equal((await coordinateRepair(g.options)).reason,'diagnostic-unavailable');assert.equal(g.sent.length,0);
 const h=fixture();h.options.diagnostics=async()=>({ready:false});assert.equal((await coordinateRepair(h.options)).status,'waiting');assert.equal(h.notices.length,0);
});
test('診断取得中のhead変更は書込前に拒否する',async()=>{
 const f=fixture();f.options.diagnostics=async()=>{f.pr.head.sha=base;return{ready:true,failed:true,entries:[{kind:'unit',message:'assert failed'}]};};
 await assert.rejects(coordinateRepair(f.options));assert.equal(f.sent.length,0);assert.equal(f.notices.length,0);
});
test('CI照合だけの失敗は理由を通知し、モデルへアプリ修正を依頼しない',async()=>{
 const f=fixture();f.pr.base.sha=base;f.pr.mergeable=true;
 f.options.diagnostics=async()=>({ready:true,failed:true,entries:[{kind:'ci-control',title:'ci-evidence-timeout',message:'照合待ちが期限切れ'}]});
 const result=await coordinateRepair(f.options);assert.equal(result.reason,'ci-control-failure');assert.equal(f.sent.length,0);assert.match(f.notices[0].body,/ci-evidence-timeout/);
 await coordinateRepair(f.options);assert.equal(f.notices.length,1);
 const g=fixture();g.pr.base.sha=base;g.pr.mergeable=true;
 g.options.diagnostics=async()=>({ready:true,failed:true,entries:[{kind:'ci-control',title:'ci-evidence-rejected',message:'通常CIが不合格'},{kind:'ui',message:'開始UIの不整合'}]});
 assert.equal((await coordinateRepair(g.options)).status,'dispatched');assert.equal(g.sent.length,1);
});
test('合格済みheadもdevelop更新後は同期し、古いpushや古い制御checkoutでは起動しない',async()=>{
 const f=fixture();f.options.eventName='push';f.options.event={ref:'refs/heads/develop',after:base,inputs:{issue:'124'}};f.options.diagnostics=async()=>({ready:true,failed:false,entries:[]});
 assert.equal((await coordinateRepair(f.options)).status,'dispatched');assert.equal(f.sent.length,1);
 const g=fixture();g.options.eventName='push';g.options.event={ref:'refs/heads/develop',after:head,inputs:{issue:'124'}};assert.equal((await coordinateRepair(g.options)).reason,'stale-develop-push');assert.equal(g.sent.length,0);
 const h=fixture();h.options.definitionSha=head;assert.equal((await coordinateRepair(h.options)).reason,'trusted-base-moved');assert.equal(h.sent.length,0);
});
test('CI合格イベントでもbaseを取り込んでいなければ同期、取り込み済みなら何もしない',async()=>{
 for(const included of [true,false]){
  const f=fixture();f.options.event.workflow_run.conclusion='success';f.options.diagnostics=async()=>({ready:true,failed:false,entries:[]});f.options.github.rest.repos.compareCommitsWithBasehead=async()=>({data:{merge_base_commit:{sha:included?base:head}}});
  assert.equal((await coordinateRepair(f.options)).status,included?'ignored':'dispatched');assert.equal(f.sent.length,included?0:1);
 }
});

test('終了済みの旧検証Issueを除外し、1件の受付失敗で他のticketを無効にしない',async()=>{
 const prs=[43,124,128].map((n,i)=>({number:n+1,head:{ref:`codex/issue-${n}`}})),sent=[],notices=[];
 const result=await repairBatch(prs,{issue:async n=>({state:n===43?'closed':'open',labels:['実装:自動']}),execute:async n=>{if(n===124)throw Error('protected path');sent.push(n);return {status:'dispatched',issue:n};},notify:async(n,b)=>notices.push(n)});
 assert.deepEqual(result.map(x=>x.status),['ignored','stopped','dispatched']);assert.deepEqual(sent,[128]);assert.deepEqual(notices,[124]);
});
