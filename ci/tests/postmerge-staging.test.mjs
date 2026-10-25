import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {developEvidence,releaseScope,runPostmergeStaging} from '../control/postmerge-staging.mjs';
import {postmergeApi} from '../control/postmerge-runner.mjs';
const policy=JSON.parse(await readFile(new URL('../control/review-trust.json',import.meta.url),'utf8'));
const revision='a'.repeat(40),treeSha='b'.repeat(40),repo='papettoTV/virtual_gamecenter',now=Date.parse('2026-10-25T04:00:00Z');
const execution={repository:repo,ref:'refs/heads/ci-control',event:'workflow_dispatch',environment:'staging',runId:'100',attempt:'1',controlSha:'d'.repeat(40)};
function fixture(){
 const run={id:10,created_at:'2026-10-25T03:00:00Z',head_sha:revision,event:'push',head_branch:'develop',head_repository:{full_name:repo},path:'.github/workflows/web-checks.yml',status:'completed',conclusion:'success',run_attempt:1};
 const artifact={id:20,name:`staging-build-${revision}-1`,size_in_bytes:100,expired:false,workflow_run:{id:10,head_sha:revision}};
 const tree={truncated:false,tree:Object.entries(policy.files).map(([path,sha])=>({path,sha,type:'blob',mode:'100644'}))};
 const latest=[run],calls=[];let head=revision;
 const api=async p=>{calls.push(p);if(p==='actions/runs/10')return run;if(p==='git/ref/heads/develop')return {object:{sha:head}};
 if(p.includes('/runs?'))return {total_count:latest.length,workflow_runs:latest};if(p.includes('/jobs?'))return {total_count:2,jobs:['verify','Automation control checks'].map(name=>({name,status:'completed',conclusion:'success'}))};
 if(p.startsWith('git/commits/'))return {tree:{sha:treeSha}};if(p.startsWith('git/trees/'))return tree;if(p.includes('/artifacts?'))return {total_count:1,artifacts:[artifact]};throw Error('unexpected '+p);};
 return {run,artifact,tree,latest,calls,api,move:()=>{head='e'.repeat(40);}};
}
test('マージ済みdevelopの同じ初回成功CI・固定定義・成果物を受け入れ、PR状態を参照しない',async()=>{
 const f=fixture(),e=await developEvidence(f.api,'10',policy,now);assert.equal(e.sha,revision);assert.equal(e.artifactId,'20');assert.ok(!f.calls.some(p=>p.startsWith('pulls/')||p.startsWith('issues/')));
});
test('PR候補CI・main・再実行・古いCI・最新CI失敗を拒否',async()=>{
 for(const change of [{event:'pull_request'},{head_branch:'main'},{run_attempt:2},{conclusion:'failure'},{created_at:'2026-10-23T03:00:00Z'}]){const f=fixture();Object.assign(f.run,change);await assert.rejects(developEvidence(f.api,'10',policy,now));}
 const f=fixture();f.latest.push({...f.run,id:11,conclusion:'failure'});await assert.rejects(developEvidence(f.api,'10',policy,now));
});
test('古いdevelop・期限切れ成果物・別SHA・固定定義改変を拒否',async()=>{
 for(const mutate of [f=>f.move(),f=>f.artifact.expired=true,f=>f.artifact.workflow_run.head_sha='f'.repeat(40),f=>f.tree.tree[0].sha='f'.repeat(40),f=>f.tree.truncated=true]){const f=fixture();mutate(f);await assert.rejects(developEvidence(f.api,'10',policy,now));}
});
test('承認後は公開1回・回帰1回のみで、マージ・再公開を行わない',async()=>{
 const f=fixture(),e=await developEvidence(f.api,'10',policy,now),scope=releaseScope(e,execution,'f'.repeat(64),now);const calls=[];
 const result=await runPostmergeStaging({scope,execution,now:()=>now+1,observe:async()=>e,publish:async()=>calls.push('publish'),regress:async()=>{calls.push('regress');return {passed:true,sha:revision};}});
 assert.deepEqual(calls,['publish','regress']);assert.equal(result.regressionCount,1);assert.equal(result.recovery,'fix-pull-request');assert.equal(result.mainUpdated,false);
});
test('回帰失敗時は同じSHAを再公開・自動巻き戻しせず修正PR対応として停止',async()=>{
 const f=fixture(),e=await developEvidence(f.api,'10',policy,now);let publishes=0,regressions=0;
 await assert.rejects(runPostmergeStaging({scope:releaseScope(e,execution,'f'.repeat(64),now),execution,now:()=>now+1,observe:async()=>e,publish:async()=>{publishes++;},regress:async()=>{regressions++;return {passed:false,sha:revision};}}),x=>x.phase==='regression'&&x.sha===revision&&x.recovery==='fix-pull-request');
 assert.equal(publishes,1);assert.equal(regressions,1);
});
test('公開失敗は回帰へ進まず、候補変更・期限切れ・別run・再実行も停止',async()=>{
 const f=fixture(),e=await developEvidence(f.api,'10',policy,now),scope=releaseScope(e,execution,'f'.repeat(64),now);let regressions=0;
 await assert.rejects(runPostmergeStaging({scope,execution,now:()=>now+1,observe:async()=>e,publish:async()=>{throw Error('private');},regress:async()=>{regressions++;}}),x=>x.phase==='publication'&&!x.message.includes('private'));assert.equal(regressions,0);
 for(const x of [{...execution,runId:'101'},{...execution,attempt:'2'}])await assert.rejects(runPostmergeStaging({scope,execution:x}));
 await assert.rejects(runPostmergeStaging({scope,execution,now:()=>now+3600000,observe:async()=>e}));
 await assert.rejects(runPostmergeStaging({scope,execution,now:()=>now+1,observe:async()=>({...e,sha:'e'.repeat(40)})}));
});
test('公開中にdevelopが動いたら別SHAへ切り替えず停止し、回帰を実行しない',async()=>{
 const f=fixture(),e=await developEvidence(f.api,'10',policy,now),scope=releaseScope(e,execution,'f'.repeat(64),now);let reads=0,regress=0;
 await assert.rejects(runPostmergeStaging({scope,execution,now:()=>now+1,observe:async()=>++reads===1?e:{...e,sha:'e'.repeat(40)},publish:async()=>{},regress:async()=>{regress++;}}));assert.equal(regress,0);
});
test('postmerge APIは固定repoへのGETのみで書込・任意URLを拒否',async()=>{
 let calls=0;const api=postmergeApi('test',async(u,o)=>{calls++;assert.equal(o.method,'GET');assert.equal(o.redirect,'error');return new Response('private',{status:403});});await assert.rejects(api('actions/runs/10'),e=>!e.message.includes('private'));await assert.rejects(api('pulls/44/merge'));await assert.rejects(api('https://elsewhere'));assert.equal(calls,1);
});
