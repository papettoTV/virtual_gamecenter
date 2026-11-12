import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {collectUiParts, splitUiTests} from '../ui-tests.mjs';
const cli=fileURLToPath(new URL('../node_modules/@playwright/test/cli.js',import.meta.url));
const playwright=fileURLToPath(new URL('../node_modules/@playwright/test/index.mjs',import.meta.url));
const env={...process.env,GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ATTEMPT:'1'};
const prefix=`ui-part-${env.GITHUB_SHA}-1-`;
const projects = ['desktop','mobile'];
async function part(root,name,files,selected){
 const dir=join(root,'ci/ui-parts',prefix+name);
 await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'discovery.json'),JSON.stringify({required:files.length>0,files,selected}));
 return dir;
}
const collect = root => collectUiParts(root,env.GITHUB_SHA,env.GITHUB_RUN_ATTEMPT);
test('4ジョブの欠落・探索の不一致・必要なblob欠落を拒否',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ui-merge-denied-'));
 const files=['sample.spec.mjs','second.spec.mjs'];
 const plan=splitUiTests(files);
 try{
  const specs=join(root,'apps/web/tests/ui');
  await mkdir(specs,{recursive:true});
  for(const file of files) await writeFile(join(specs,file),'');
  await part(root,'desktop-1',files,plan[0]);await assert.rejects(collect(root));
  for(const name of ['desktop-2','mobile-1','mobile-2']) {
   await part(root,name,files,plan[Number(name.at(-1))-1]);
  }
  await assert.rejects(collect(root),/ファイル構成/);
  const path=join(root,'ci/ui-parts',prefix+'desktop-1','blob');
  await mkdir(path);
  await writeFile(join(path,'desktop-1.zip'),'fixture');
  await part(root,'desktop-2',files,plan[0]);
  await assert.rejects(collect(root),/不一致/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('UI未定義の場合も4ジョブの探索証跡を必須にする',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ui-merge-empty-'));
 try{
  for(const project of projects)for(const shard of [1,2])await part(root,`${project}-${shard}`,[],[]);
  await collect(root);
  assert.deepEqual(JSON.parse(await readFile(join(root,'ci/ui-results/discovery.json'))),{required:false,files:[]});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('実Playwrightのblobを統合して両project・添付・失敗・skip・再試行回数を保持（ブラウザ不使用）',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ui-merge-reports-'));
 try{
  const specDir=join(root,'apps/web/tests/ui');
  const files=['sample.spec.mjs','second.spec.mjs'];
  const plan=splitUiTests(files);
  await mkdir(specDir,{recursive:true});
  await writeFile(join(specDir,'second.spec.mjs'),`import {test} from ${JSON.stringify(playwright)}; test('second shard',()=>{});`);
  await writeFile(join(specDir,'sample.spec.mjs'),`import {test,expect} from ${JSON.stringify(playwright)};\ntest('attachment',async({},info)=>{await info.attach('proof',{body:Buffer.from('evidence'),contentType:'text/plain'});});\ntest('failure',()=>expect(1).toBe(2));\ntest.skip('skipped',()=>{});`);
  await writeFile(join(root,'playwright.config.mjs'),`export default {testDir:'./apps/web/tests/ui',testMatch:'*.spec.mjs',workers:1,retries:0,projects:[{name:'desktop'},{name:'mobile'}]};`);
  for(const project of projects)for(const [index,selected] of plan.entries()){
   const name=`${project}-${index+1}`;
   const dir=await part(root,name,files,selected);
   const result=spawnSync(process.execPath,[cli,'test','--project='+project,'--reporter=blob',...selected],{cwd:root,env:{...env,PLAYWRIGHT_BLOB_OUTPUT_FILE:join(dir,'blob',name+'.zip')},encoding:'utf8'});
   assert.equal(result.status,selected.includes('sample.spec.mjs')?1:0,result.stderr);
  }
  await collect(root);
  const result=spawnSync(process.execPath,[cli,'merge-reports','--reporter=json,html','ci/ui-results/blob'],{cwd:root,env:{...env,PLAYWRIGHT_JSON_OUTPUT_FILE:join(root,'ci/ui-results/report.json'),PLAYWRIGHT_HTML_OUTPUT_DIR:join(root,'ci/ui-results/html')},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(await readFile(join(root,'ci/ui-results/report.json')));
  assert.equal(report.stats.expected,4);assert.equal(report.stats.unexpected,2);assert.equal(report.stats.skipped,2);assert.equal(report.stats.flaky,0);
  const tests=report.suites.flatMap(s=>s.specs.flatMap(x=>x.tests));
  assert.deepEqual([...new Set(tests.map(t=>t.projectName))].sort(),['desktop','mobile']);
  assert.ok(tests.every(t=>t.results.every(r=>r.retry===0)));
  const attachments=tests.flatMap(t=>t.results.flatMap(r=>r.attachments)).filter(a=>a.name==='proof');assert.equal(attachments.length,2);
  assert.ok(attachments.every(a=>Buffer.from(a.body,'base64').toString()==='evidence'));
  assert.ok((await readFile(join(root,'ci/ui-results/html/index.html'))).length>0);
 }finally{await rm(root,{recursive:true,force:true});}
});
