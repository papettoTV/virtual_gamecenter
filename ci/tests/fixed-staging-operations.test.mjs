import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {connectedStagingOperations} from '../control/fixed-staging-operations.mjs';
import {parseBrowserReport,runFixedBrowser} from '../control/fixed-process.mjs';
import {releaseScope,runPostmergeStaging} from '../control/postmerge-staging.mjs';
const sha='a'.repeat(40),tree='b'.repeat(40);
const execution={repository:'papettoTV/virtual_gamecenter',ref:'refs/heads/ci-control',event:'workflow_dispatch',environment:'staging',runId:'100',attempt:'1',controlSha:'d'.repeat(40)};
const browserReport=()=>({config:{private:'dummy-secret-do-not-retain'},suites:[{specs:Array.from({length:4},()=>({tests:[{},{}]}))}],errors:[],stats:{expected:8,unexpected:0,flaky:0,skipped:0}});
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'connected-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'worker'));await mkdir(join(dir,'client'));
 const gateway=(await readFile(new URL('../control/staging-gateway.mjs',import.meta.url),'utf8')).replace('__PULBASE_GATEWAY_REVISION__',sha);
 const files={};for(const [p,b] of [['worker/index.js',`export default {}; // ${sha}`],['client/_worker.js',gateway]]){await writeFile(join(dir,p),b);files[p]=createHash('sha256').update(b).digest('hex');}
 const manifest=JSON.stringify({version:1,environment:'staging',sha,tree,runId:'10',attempt:'1',files});await writeFile(join(dir,'manifest.json'),manifest);
 const e={repository:execution.repository,environment:'staging',sha,tree,runId:'10',attempt:'1',artifactId:'20',policyDigest:'f'.repeat(64)};
 return {mode:'keyless',scope:releaseScope(e,execution,createHash('sha256').update(manifest).digest('hex')),execution,artifactDirectory:dir,guard:async()=>e};
}
test('JSONの秘密値を保持せず、8件読込を実回帰合格として扱わない',()=>{
 const raw=browserReport();raw.stats={expected:0,skipped:8};
 assert.deepEqual(parseBrowserReport(JSON.stringify(raw),{listOnly:true}),{listOnly:true,listedTests:8});
 assert.throws(()=>parseBrowserReport(JSON.stringify(raw)));
 assert.ok(!JSON.stringify(parseBrowserReport(JSON.stringify(browserReport()))).includes('dummy-secret'));
 for(const change of [r=>r.errors.push({message:'private'}),r=>r.suites=[],r=>r.stats.flaky=1,r=>r.stats.unexpected=1,r=>r.stats.skipped=1]){const r=browserReport();change(r);assert.throws(()=>parseBrowserReport(JSON.stringify(r)));}
 assert.throws(()=>parseBrowserReport('private'),e=>!e.message.includes('private'));
});
test('ブラウザは固定config・引数配列で起動し、起動失敗や不正出力を拒否',async()=>{
 const result=await runFixedBrowser({environment:{PATH:'test'},listOnly:true,process:async(tool,args,opts)=>{assert.equal(tool,'playwright');assert.ok(args.includes('--list'));assert.ok(args.includes('--reporter=json'));assert.ok(args[2].endsWith('/ci/control/toolchain/staging-browser.config.mjs'));assert.deepEqual(opts.env,{PATH:'test'});return {exitCode:0,stdout:JSON.stringify(browserReport())};}});
 assert.equal(result.listOnly,true);
 await assert.rejects(runFixedBrowser({environment:{},process:async()=>({exitCode:1,stdout:'private'})}),e=>!e.message.includes('private'));
});
test('鍵なし接続は公開1回・回帰1回、Worker dry-runとbrowser listのみ実行し認証・ネットワークを使わない',async t=>{
 const f=await fixture(t),calls=[];
 f.credentials={cloudflareToken:'dummy-cf',username:'dummy-user',password:'dummy-password'};
 f.ports={request:async()=>{throw Error('ネットワーク不可');},process:async(tool,args,opts)=>{calls.push({tool,args});for(const key of ['GH_TOKEN','OPENAI_API_KEY','CLOUDFLARE_API_TOKEN','PULBASE_CHECK_PASSWORD'])assert.equal(opts.env[key],undefined);if(tool==='wrangler')assert.ok(args.includes('--dry-run'));else assert.ok(args.includes('--list'));return {exitCode:0,stdout:JSON.stringify(browserReport())};}};
 const ops=await connectedStagingOperations(f),r=await runPostmergeStaging({scope:f.scope,execution,observe:f.guard,publish:ops.publish,regress:ops.regress});
 assert.equal(r.publicationCount,1);assert.equal(r.regressionCount,1);assert.deepEqual(calls.map(x=>x.tool),['wrangler','playwright']);
 assert.equal(ops.report().realDeploymentExecuted,false);assert.equal(ops.report().realRegressionExecuted,false);assert.equal(ops.report().workerDryRunExecuted,true);assert.equal(ops.report().browserCommandValidated,true);
 assert.deepEqual(ops.report().commandAudit.map(x=>x.phase),['worker','pages','http','browser']);
});
test('live transportはダミー認証の注入試験だけで、CF鍵とBasicを別プロセスへ限定',async t=>{
 const f=await fixture(t);f.mode='live';f.credentials={cloudflareToken:'dummy-cf',username:'dummy-user',password:'dummy-password'};const commands=[];
 f.ports={request:async(url,opts)=>{if(url.startsWith('https://api.cloudflare.com/')){assert.equal(opts.method,'GET');assert.ok(url.endsWith('/pages/projects/virtual-gamecenter'));assert.equal(opts.headers.Authorization,'Bearer dummy-cf');return Response.json({success:true,result:{name:'virtual-gamecenter',production_branch:'main',source:{config:{preview_deployment_setting:'none',production_deployments_enabled:false}},build_config:{}}});}
 assert.equal(opts.redirect,'manual');assert.equal(opts.headers.Authorization,'Basic '+Buffer.from('dummy-user:dummy-password').toString('base64'));return new Response('',{headers:{'x-pulbase-revision':sha,'x-pulbase-gateway-revision':sha}});},
 process:async(tool,args,opts)=>{commands.push({tool,args});assert.equal(opts.env.GH_TOKEN,undefined);assert.equal(opts.env.OPENAI_API_KEY,undefined);
 if(tool==='wrangler'){assert.equal(opts.env.CLOUDFLARE_API_TOKEN,'dummy-cf');assert.equal(opts.env.PULBASE_CHECK_PASSWORD,undefined);assert.ok(!args.includes('--dry-run'));}
 else{assert.equal(opts.env.CLOUDFLARE_API_TOKEN,undefined);assert.equal(opts.env.PULBASE_CHECK_PASSWORD,'dummy-password');assert.ok(!args.includes('--list'));}
 return {exitCode:0,stdout:JSON.stringify(browserReport())};}};
 const ops=await connectedStagingOperations(f);await ops.publish();await ops.regress();assert.deepEqual(commands.map(x=>x.tool),['wrangler','wrangler','playwright']);
 assert.equal(ops.report().realRegressionExecuted,true);assert.ok(!JSON.stringify(ops.report()).includes('dummy-'));
});
test('成果物差替え・古いSHAは命令前に停止',async t=>{
 for(const kind of ['manifest','stale']){
  const f=await fixture(t);let calls=0,stale=false;
  f.guard=async()=>stale?{...f.scope.evidence,sha:'e'.repeat(40)}:f.scope.evidence;
  f.ports={process:async()=>{calls++;return {exitCode:0};}};
  const ops=await connectedStagingOperations(f);
  if(kind==='manifest')await writeFile(join(f.artifactDirectory,'manifest.json'),'{}');else stale=true;
  await assert.rejects(ops.publish());assert.equal(calls,0);
 }
});
test('Worker失敗はPages・HTTP・browserへ進まず、再試行しない',async t=>{
 const f=await fixture(t);let calls=0;f.ports={process:async()=>{calls++;return {exitCode:1,stdout:'private'};}};
 const ops=await connectedStagingOperations(f);await assert.rejects(runPostmergeStaging({scope:f.scope,execution,observe:f.guard,publish:ops.publish,regress:ops.regress}),e=>e.phase==='publication'&&!e.message.includes('private'));assert.equal(calls,1);assert.equal(ops.report().browserCommandValidated,false);
});
test('HTTP不合格はブラウザ起動前で止まり、実行済みと不合格を区別する',async t=>{
 const f=await fixture(t);f.mode='live';f.credentials={cloudflareToken:'dummy-cf',username:'dummy',password:'dummy'};let calls=0;
 f.ports={request:async()=>new Response('',{status:302}),process:async()=>{calls++;}};
 const ops=await connectedStagingOperations(f);await assert.rejects(ops.regress());assert.equal(calls,0);assert.equal(ops.report().realRegressionExecuted,true);assert.equal(ops.report().regressionPassed,false);
});
test('browserは検証originだけにBasicを送り、外部HTTP/WSとService Workerを遮断',async()=>{
 const config=await readFile(new URL('../control/toolchain/staging-browser.config.mjs',import.meta.url),'utf8');const spec=await readFile(new URL('../control/toolchain/browser/regression.spec.mjs',import.meta.url),'utf8');
 assert.ok(config.includes("origin:'https://develop.virtual-gamecenter.pages.dev'"));assert.ok(config.includes("serviceWorkers:'block'"));assert.ok(!config.includes('outputFile:'));assert.ok(spec.includes('routeWebSocket'));assert.ok(spec.includes('route.abort()'));assert.ok(spec.includes('socket.close()'));
});

test('公開途中で失敗したらWorker反映・Pages結果不明を記録し再試行しない',async t=>{
 const f=await fixture(t);f.mode='live';f.credentials={cloudflareToken:'dummy-cf',username:'dummy',password:'dummy'};let calls=0;
 f.ports={request:async()=>Response.json({success:true,result:{name:'virtual-gamecenter',production_branch:'main'}}),process:async()=>({exitCode:++calls===1?0:1,stdout:'private'})};
 const ops=await connectedStagingOperations(f);await assert.rejects(ops.publish());const s=ops.report();assert.equal(calls,2);assert.equal(s.workerOutcome,'uploaded');assert.equal(s.pagesOutcome,'unknown');assert.equal(s.realDeploymentAttempted,true);assert.equal(s.httpAttempted,false);
 const {failureReport}=await import('../control/postmerge-runner.mjs');const report=failureReport({phase:'publication',sha,operationStatus:s});assert.equal(report.partialPublicationPossible,true);assert.equal(report.pagesOutcome,'unknown');assert.ok(!JSON.stringify(report).includes('private'));
});
test('実公開は認証3項目がそろうまでネットワークもプロセスも起動しない',async t=>{
 const {liveCredentials}=await import('../control/postmerge-runner.mjs');
 for(const credentials of [{},{CLOUDFLARE_API_TOKEN:'dummy'}, {CLOUDFLARE_API_TOKEN:'dummy',PULBASE_CHECK_USERNAME:'dummy',PULBASE_CHECK_PASSWORD:' '}])assert.throws(()=>liveCredentials(credentials));
 const f=await fixture(t);f.mode='live';let calls=0;f.ports={request:async()=>{calls++;},process:async()=>{calls++;}};
 await assert.rejects(connectedStagingOperations(f));assert.equal(calls,0);
});
