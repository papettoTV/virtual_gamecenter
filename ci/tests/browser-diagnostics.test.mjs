import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserDiagnostics,sanitizeBrowserFailure,runFixedBrowser} from '../control/fixed-process.mjs';
import {failureReport} from '../control/postmerge-runner.mjs';
import {diagnoseStaging} from '../../tools/staging-browser-diagnostics.mjs';
const titles=['home renders active games and versioned Worker/Pages','legal navigation /legal/terms','legal navigation /legal/privacy','game navigation allows declining credit and returning before play'];
function report(){return {config:{httpCredentials:{username:'PRIVATE_USER',password:'PRIVATE_PASSWORD'}},errors:[],stats:{expected:7,unexpected:1,flaky:0,skipped:0},suites:[{specs:titles.map(title=>({title,tests:['desktop','mobile'].map(projectName=>({projectName,results:[{status:'passed',duration:12,errors:[],stdout:['PRIVATE_STDOUT'],attachments:[{path:'PRIVATE_PATH'}]}]}))}))}]};}
test('実レポート形式から固定ケースと失敗行だけを残し、認証・期待値・添付を捨てる',()=>{
 const r=report(),failed=r.suites[0].specs[3].tests[1].results[0];
 failed.status='timedOut';failed.errors=[{message:'Timeout: expected PRIVATE_PASSWORD at https://private.invalid',stack:'at /private/work/ci/control/toolchain/browser/regression.spec.mjs:63:12',location:{file:'/private/work/ci/control/toolchain/browser/regression.spec.mjs',line:63}}];
 const d=browserDiagnostics(JSON.stringify(r),1);
 assert.equal(d.kind,'test-results');assert.equal(d.cases.length,8);
 assert.deepEqual(d.cases.at(-1),{case:'game-navigation',project:'mobile',status:'timedOut',durationMs:12,errors:[{category:'timeout',line:63}]});
 assert.doesNotMatch(JSON.stringify(d),/PRIVATE|https:|private\/work|httpCredentials|attachments|stdout/);
});
test('任意タイトル・project・再試行・不正JSONや過大入力を診断から除外し合格にしない',async()=>{
 for(const mutate of [r=>r.suites[0].specs[0].title='PRIVATE_TITLE',r=>r.suites[0].specs[0].tests[0].projectName='PRIVATE_PROJECT',r=>r.suites[0].specs[0].tests[0].results.push({status:'passed'}),r=>r.suites[0].specs[0].tests.push(r.suites[0].specs[0].tests[0])]){
  const r=report();mutate(r);assert.equal(browserDiagnostics(JSON.stringify(r),1).kind,'invalid-report');
 }
 for(const raw of ['PRIVATE_INVALID','x'.repeat(8*1024*1024+1)]){
  const d=browserDiagnostics(raw,1);assert.equal(d.cases.length,0);assert.doesNotMatch(JSON.stringify(d),/PRIVATE/);
  await assert.rejects(runFixedBrowser({environment:{},process:async()=>({exitCode:1,stdout:raw})}),e=>e.browserFailure.cases.length===0&&!e.message.includes('PRIVATE'));
 }
 const r=report();r.suites[0].specs.pop();assert.equal(browserDiagnostics(JSON.stringify(r),1).kind,'incomplete-report');
});
test('失敗を処理層で再サニタイズし、例外や任意の追加フィールドを成果物に残さない',()=>{
 const value=browserDiagnostics(JSON.stringify(report()),1);value.raw='PRIVATE_RAW';value.cases[0].errors=[{category:'PRIVATE_CATEGORY',line:'PRIVATE_LINE',message:'PRIVATE_MESSAGE'}];
 const sanitized=sanitizeBrowserFailure(value);
 const result=failureReport({phase:'regression',sha:'a'.repeat(40),operationStatus:{browserAttempted:true,browserFailure:value}});
 assert.deepEqual(result.browserFailure,sanitized);assert.equal(result.browserFailure.cases[0].errors[0].category,'other');assert.equal(result.browserFailure.cases[0].errors[0].line,null);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});
test('起動失敗や不合格JSONを安全な診断付き例外にし、成功判定の8件条件を維持する',async()=>{
 const r=report();r.suites[0].specs[0].tests[0].results[0].status='failed';
 await assert.rejects(runFixedBrowser({environment:{},process:async()=>({exitCode:1,stdout:JSON.stringify(r)})}),e=>e.browserFailure.cases[0].status==='failed');
 await assert.rejects(runFixedBrowser({environment:{},process:async()=>({exitCode:0,stdout:JSON.stringify(r)})}),e=>e.browserFailure.kind==='test-results');
 r.stats={expected:8,unexpected:0,flaky:0,skipped:0};r.suites[0].specs[0].tests[0].results[0].status='passed';
 assert.equal((await runFixedBrowser({environment:{},process:async()=>({exitCode:0,stdout:JSON.stringify(r)})})).stats.expected,8);
});
test('読取診断は固定検証URLのGETとSHA検査後だけブラウザを起動し、公開鍵を渡さない',async()=>{
 const sha='a'.repeat(40),input={sha,username:'PRIVATE_USER',password:'PRIVATE_PASSWORD'};let launches=0;
 const request=async(url,opts)=>{assert.equal(url,`https://develop.virtual-gamecenter.pages.dev/?release-check=${sha}`);assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');return new Response('',{headers:{'x-pulbase-revision':sha,'x-pulbase-gateway-revision':sha}});};
 const browser=async({environment})=>{launches++;assert.equal(environment.PULBASE_CHECK_PASSWORD,input.password);assert.equal(environment.GH_TOKEN,undefined);assert.equal(environment.CLOUDFLARE_API_TOKEN,undefined);const e=Error('PRIVATE_ERROR');e.browserFailure=browserDiagnostics(JSON.stringify(report()),1);throw e;};
 const result=await diagnoseStaging(input,{request,browser});assert.equal(launches,1);assert.equal(result.httpPassed,true);assert.equal(result.browserPassed,false);assert.equal(result.deploymentRequested,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 const stopped=await diagnoseStaging(input,{request:async()=>new Response('',{status:401}),browser});assert.equal(stopped.stage,'http');assert.equal(launches,1);
});
