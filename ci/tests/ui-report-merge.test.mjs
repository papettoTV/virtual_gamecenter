import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';
const workflow=parse(await readFile(new URL('../../.github/workflows/web-checks.yml',import.meta.url),'utf8'));
const merge=workflow.jobs.verify.steps.find(s=>s.run?.includes("const root='ci/ui-parts'"));
const script=merge.run.split("<<'JS'\n")[1].split('\nJS\n')[0];
const cli=fileURLToPath(new URL('../node_modules/@playwright/test/cli.js',import.meta.url));
const playwright=fileURLToPath(new URL('../node_modules/@playwright/test/index.mjs',import.meta.url));
const env={...process.env,GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ATTEMPT:'1'};
const prefix=`ui-part-${env.GITHUB_SHA}-1-`;
async function part(root,project,discovery){
 const dir=join(root,'ci/ui-parts',prefix+project);await mkdir(dir,{recursive:true});await writeFile(join(dir,'discovery.json'),JSON.stringify(discovery));return dir;
}
function collect(root){return spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,env,encoding:'utf8'});}
test('片方の証跡欠落・異なる探索結果・必要なblob欠落を拒否',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ui-merge-denied-'));
 try{
  await part(root,'desktop',{required:true,files:['sample.spec.mjs']});assert.notEqual(collect(root).status,0);
  await part(root,'mobile',{required:true,files:['other.spec.mjs']});assert.notEqual(collect(root).status,0);
  await part(root,'mobile',{required:true,files:['sample.spec.mjs']});assert.notEqual(collect(root).status,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('UI未定義の場合も両projectの探索証跡を必須にする',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ui-merge-empty-'));
 try{
  for(const p of ['desktop','mobile'])await part(root,p,{required:false,files:[]});
  assert.equal(collect(root).status,0);assert.deepEqual(JSON.parse(await readFile(join(root,'ci/ui-results/discovery.json'))),{required:false,files:[]});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('実Playwrightのblobを統合して両project・添付・失敗・skip・再試行回数を保持（ブラウザ不使用）',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ui-merge-reports-'));
 try{
  await writeFile(join(root,'sample.spec.mjs'),`import {test,expect} from ${JSON.stringify(playwright)};\ntest('attachment',async({},info)=>{await info.attach('proof',{body:Buffer.from('evidence'),contentType:'text/plain'});});\ntest('failure',()=>expect(1).toBe(2));\ntest.skip('skipped',()=>{});`);
  await writeFile(join(root,'playwright.config.mjs'),`export default {testDir:'.',testMatch:'sample.spec.mjs',workers:1,retries:0,projects:[{name:'desktop'},{name:'mobile'}]};`);
  for(const project of ['desktop','mobile']){
   const dir=await part(root,project,{required:true,files:['sample.spec.mjs']});
   const result=spawnSync(process.execPath,[cli,'test','--project='+project,'--reporter=blob'],{cwd:root,env:{...env,PLAYWRIGHT_BLOB_OUTPUT_FILE:join(dir,'blob',project+'.zip')},encoding:'utf8'});
   assert.equal(result.status,1,result.stderr);
  }
  const collected=collect(root);assert.equal(collected.status,0,collected.stderr);
  const result=spawnSync(process.execPath,[cli,'merge-reports','--reporter=json,html','ci/ui-results/blob'],{cwd:root,env:{...env,PLAYWRIGHT_JSON_OUTPUT_FILE:join(root,'ci/ui-results/report.json'),PLAYWRIGHT_HTML_OUTPUT_DIR:join(root,'ci/ui-results/html')},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(await readFile(join(root,'ci/ui-results/report.json')));
  assert.equal(report.stats.expected,2);assert.equal(report.stats.unexpected,2);assert.equal(report.stats.skipped,2);assert.equal(report.stats.flaky,0);
  const tests=report.suites.flatMap(s=>s.specs.flatMap(x=>x.tests));
  assert.deepEqual([...new Set(tests.map(t=>t.projectName))].sort(),['desktop','mobile']);
  assert.ok(tests.every(t=>t.results.every(r=>r.retry===0)));
  const attachments=tests.flatMap(t=>t.results.flatMap(r=>r.attachments)).filter(a=>a.name==='proof');assert.equal(attachments.length,2);
  assert.ok(attachments.every(a=>Buffer.from(a.body,'base64').toString()==='evidence'));
  assert.ok((await readFile(join(root,'ci/ui-results/html/index.html'))).length>0);
 }finally{await rm(root,{recursive:true,force:true});}
});
