import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {prepareStagingPublication,executeStagingPublication,dryRunStaging,assertStagingPages,validateStagingTarget,publicationCommands} from '../control/staging-publication.mjs';
import {stagingRegression,regressionEnvironment} from '../control/staging-regression.mjs';
import {mergeReviewedCandidate,mergedCiEvidence} from '../control/staging-merge.mjs';
const sha='a'.repeat(40),tree='b'.repeat(40),base='c'.repeat(40),repo='papettoTV/virtual_gamecenter';
async function build(){
 const dir=await mkdtemp(join(tmpdir(),'runtime-test-'));await mkdir(join(dir,'worker'));await mkdir(join(dir,'client'));
 const gateway=(await readFile(new URL('../control/staging-gateway.mjs',import.meta.url),'utf8')).replace('__PULBASE_GATEWAY_REVISION__',sha);
 const files={};for(const [p,b] of [['worker/index.js',`export default {}; // ${sha}`],['client/_worker.js',gateway]]){await writeFile(join(dir,p),b);files[p]=createHash('sha256').update(b).digest('hex');}
 await writeFile(join(dir,'manifest.json'),JSON.stringify({version:1,environment:'staging',sha,tree,runId:'10',attempt:'1',files}));
 return {dir,receipt:{candidate:sha,tree,buildRun:'10',buildAttempt:'1'},cleanup:()=>rm(dir,{recursive:true,force:true})};
}
const project=()=>({name:'virtual-gamecenter',production_branch:'main',source:{config:{preview_deployment_setting:'none',production_deployments_enabled:false}},build_config:{build_command:'existing'}});
test('固定staging設定から計画を作り、候補の設定/公開先/命令を受け入れない',async()=>{
 const f=await build();try{const p=await prepareStagingPublication(f.dir,f.receipt);const c=publicationCommands(p);assert.ok(c.pages.includes('develop'));assert.ok(c.worker.includes('--no-bundle'));assert.equal(p.worker,'pulbase-staging');assert.ok(Object.isFrozen(p));const config=JSON.parse(await readFile(p.workerConfig));assert.equal(config.name,'pulbase-staging');assert.equal(config.build,undefined);assert.deepEqual(config.routes,[]);await rm(p.prepared,{recursive:true,force:true});}finally{await f.cleanup();}
 const t=JSON.parse(await readFile(new URL('../control/staging-target.json',import.meta.url)));assert.throws(()=>validateStagingTarget({...t,name:'pulbase-production'}));assert.throws(()=>validateStagingTarget({...t,build:{command:'malicious'}}));
});
test('各書込前に再確認し、Worker後の候補変更ならPagesに進まない',async()=>{
 const f=await build();let p;try{p=await prepareStagingPublication(f.dir,f.receipt);let guards=0;const commands=[];
 await assert.rejects(executeStagingPublication(p,{guard:async()=>{if(++guards===3)throw Error('stale');},transport:{project:async()=>project(),execute:async a=>commands.push(a)}}),e=>e.workerOutcome==='uploaded');assert.equal(commands.length,1);
 }finally{if(p)await rm(p.prepared,{recursive:true,force:true});await f.cleanup();}
});
test('Pages自動公開有効や設定変化は停止し、自動PATCH/巻き戻しをしない',async()=>{
 assert.throws(()=>assertStagingPages({...project(),source:{config:{preview_deployment_setting:'all',production_deployments_enabled:true}}}));
 const f=await build();let p;try{p=await prepareStagingPublication(f.dir,f.receipt);let reads=0;const commands=[];
 await assert.rejects(executeStagingPublication(p,{guard:async()=>{},transport:{project:async()=>{const x=project();if(++reads===3)x.build_config={build_command:'changed'};return x;},execute:async a=>commands.push(a)}}));assert.equal(commands.length,2);
 }finally{if(p)await rm(p.prepared,{recursive:true,force:true});await f.cleanup();}
});
test('Worker timeoutは部分結果不明として停止し再試行しない',async()=>{
 const f=await build();let p;try{p=await prepareStagingPublication(f.dir,f.receipt);let commands=0;await assert.rejects(executeStagingPublication(p,{guard:async()=>{},transport:{project:async()=>project(),execute:async()=>{commands++;throw Error('secret');}}}),e=>e.workerOutcome==='unknown'&&!e.message.includes('secret'));assert.equal(commands,1);}finally{if(p)await rm(p.prepared,{recursive:true,force:true});await f.cleanup();}
});
test('dry-runはWorkerのみで、親の認証envやPages命令を渡さない',async()=>{
 const f=await build();let p;try{p=await prepareStagingPublication(f.dir,f.receipt);await dryRunStaging(p,async(args,opts)=>{assert.ok(args.includes('--dry-run'));assert.equal(args[0],'deploy');assert.equal(opts.env.CLOUDFLARE_API_TOKEN,undefined);assert.equal(opts.env.GH_TOKEN,undefined);assert.equal(opts.env.OPENAI_API_KEY,undefined);});}finally{if(p)await rm(p.prepared,{recursive:true,force:true});await f.cleanup();}
});
test('回帰先は検証URLだけ、HTTPの両SHAとブラウザ8件合格を必須にする',async()=>{
 let guards=0;const result=await stagingRegression(sha,{guard:async()=>{guards++;},credentials:{username:'dummy',password:'dummy'},request:async(url,opts)=>{assert.ok(url.startsWith('https://develop.virtual-gamecenter.pages.dev/'));assert.equal(opts.redirect,'manual');return new Response('',{headers:{'x-pulbase-revision':sha,'x-pulbase-gateway-revision':sha}});},browser:async({environment})=>{assert.equal(environment.CLOUDFLARE_API_TOKEN,undefined);assert.equal(environment.GH_TOKEN,undefined);return {exitCode:0,stats:{expected:8,unexpected:0,flaky:0,skipped:0}};}});
 assert.equal(result.passed,true);assert.equal(guards,3);assert.throws(()=>regressionEnvironment(sha,{username:'only'}));
 await assert.rejects(stagingRegression(sha,{guard:async()=>{},browser:async()=>{},request:async()=>new Response('',{status:302})}));
});
test('同じheadを指定したsquashだけを要求し、実マージの親とtreeを照合',async()=>{
 const intent={repository:repo,baseRef:'develop',pullNumber:'44',head:sha,base,tree};let puts=0;
 const api=async(method,path,body)=>{if(path==='branches/develop/protection')return {enforce_admins:{enabled:true},required_status_checks:{strict:true,checks:['verify','Automation control checks'].map(context=>({context,app_id:15368}))}};
 if(method==='PUT'){puts++;assert.deepEqual(body,{sha,merge_method:'squash'});return {merged:true,sha:'d'.repeat(40)};}
 if(path.startsWith('git/commits'))return {tree:{sha:tree},parents:[{sha:base}]};return {object:{sha:'d'.repeat(40)}};};
 const m=await mergeReviewedCandidate(intent,{api,guard:async()=>{}});assert.equal(m.method,'squash');assert.equal(puts,1);
 await assert.rejects(mergeReviewedCandidate(intent,{api,guard:async()=>{throw Error('stale');}}));assert.equal(puts,1);
});
test('マージAPI timeoutではunknown、マージ後不一致ではSHAを残して停止',async()=>{
 const intent={repository:repo,baseRef:'develop',pullNumber:'44',head:sha,base,tree};let puts=0;
 const api=async(m,p)=>{if(p==='branches/develop/protection')return {enforce_admins:{enabled:true},required_status_checks:{strict:true,checks:['verify','Automation control checks'].map(context=>({context,app_id:15368}))}};if(m==='PUT'){puts++;throw Error('token');}};
 await assert.rejects(mergeReviewedCandidate(intent,{api,guard:async()=>{}}),e=>e.outcome==='unknown'&&!e.message.includes('token'));assert.equal(puts,1);
 const broken=async(m,p)=>m==='PUT'?{merged:true,sha:'d'.repeat(40)}:p.startsWith('git/commits')?{tree:{sha:'e'.repeat(40)},parents:[{sha:base}]}:p.startsWith('git/ref')?{object:{sha:'d'.repeat(40)}}:api(m,p);
 await assert.rejects(mergeReviewedCandidate(intent,{api:broken,guard:async()=>{}}),e=>e.outcome==='merged-unverified'&&e.mergedSha==='d'.repeat(40));
});
test('実マージSHAの最新push CI・必須ジョブ・成果物だけを受理し候補CI流用を拒否',async()=>{
 const merged={repository:repo,baseRef:'develop',sha,tree,parents:[base]};
 const run={id:10,head_sha:sha,event:'push',status:'completed',conclusion:'success',run_attempt:1,head_branch:'develop',head_repository:{full_name:repo},path:'.github/workflows/web-checks.yml'};
 const api=async(m,p)=>p.includes('/runs?')?{total_count:1,workflow_runs:[run]}:p.includes('/jobs?')?{total_count:2,jobs:['verify','Automation control checks'].map(name=>({name,status:'completed',conclusion:'success'}))}:p.includes('/artifacts?')?{total_count:1,artifacts:[{id:30,name:`staging-build-${sha}-1`,expired:false,size_in_bytes:100,workflow_run:{id:10,head_sha:sha}}]}:p.startsWith('git/ref')?{object:{sha}}:{tree:{sha:tree},parents:[{sha:base}]};
 assert.equal((await mergedCiEvidence(merged,api)).artifactId,'30');run.event='pull_request';assert.equal(await mergedCiEvidence(merged,api),null);run.event='push';run.run_attempt=2;await assert.rejects(mergedCiEvidence(merged,api));
});
