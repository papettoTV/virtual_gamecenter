import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync,spawnSync} from 'node:child_process';
import {prepareRepairWorkspace} from '../repair-workspace.mjs';
const publisher=fileURLToPath(new URL('../publish-patch.mjs',import.meta.url));
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function run(mode){
 const previous=process.cwd(),root=await mkdtemp(join(tmpdir(),'repair-publisher-'));
 try{
  process.chdir(root);git('init','--bare','remote.git');git('clone',join(root,'remote.git'),'work');process.chdir(join(root,'work'));git('switch','-c','develop');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('config','commit.gpgsign','false');
  await mkdir('apps/web/src',{recursive:true});await mkdir('ci');await writeFile('apps/web/src/app.js','const value=0;\n');await writeFile('ci/control.mjs','trusted old\n');git('add','.');git('commit','-m','base');const observedBase=git('rev-parse','HEAD');
  git('switch','-c','codex/issue-1');await writeFile('apps/web/src/app.js','const value=1;\n');git('add','.');git('commit','-m','application');const head=git('rev-parse','HEAD');git('push','origin','codex/issue-1');
  git('switch','develop');if(mode!=='sync')await writeFile('apps/web/src/app.js','const value=2;\n');await writeFile('ci/control.mjs','trusted latest\n');git('add','.');git('commit','-m','new develop');const base=git('rev-parse','HEAD');git('push','origin','develop');
  git('checkout','--detach',head);prepareRepairWorkspace({head,base});await writeFile('apps/web/src/app.js','const value=3;\n');let patch=git('diff','HEAD')+'\n';
  if(mode==='unresolved'||mode==='sync')patch='';
  if(mode==='protected')patch+='diff --git a/ci/control.mjs b/ci/control.mjs\n--- a/ci/control.mjs\n+++ b/ci/control.mjs\n@@ -1 +1 @@\n-trusted latest\n+unsafe\n';
  git('reset','--hard',base);git('branch','-D','codex/issue-1');
  const pr={number:2,state:'open',draft:false,user:{login:'pulbase-codex[bot]'},mergeable:false,base:{ref:'develop',sha:observedBase,repo:{full_name:'papettoTV/virtual_gamecenter'}},head:{ref:'codex/issue-1',sha:head,repo:{full_name:'papettoTV/virtual_gamecenter'}}};
  const bin=join(root,'bin');await mkdir(bin);const gh=join(bin,'gh');
  await writeFile(gh,`#!${process.execPath}\nconst p=process.argv[3];if(p.endsWith('/issues/1'))console.log(JSON.stringify({state:'open',labels:['実装:自動']}));else if(p.endsWith('/pulls/2'))console.log(${JSON.stringify(JSON.stringify(pr))});else if(p.endsWith('/git/ref/heads/develop'))console.log(JSON.stringify({object:{sha:${JSON.stringify(mode==='stale'?head:base)}}}));else process.exit(1);`);await chmod(gh,0o700);
  const result=join(root,'result.json');await writeFile(result,JSON.stringify({summary:'競合と検査を修正',patch,assets:[]}));
  const output=spawnSync(process.execPath,[publisher],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,RESULT_FILE:result,ISSUE_NUMBER:'1',BASE_SHA:head,TRUSTED_BASE_SHA:base,PULL_NUMBER:'2',PR_HEAD_SHA:head,OBSERVED_BASE_SHA:observedBase,REPAIR_MODE:'true',AUTOMATION_BOT:'pulbase-codex[bot]',PATCH_FILE:join(root,'patch'),PR_BODY_FILE:join(root,'body')}});
  const actual=git('ls-remote','origin','refs/heads/codex/issue-1').split(/\s/)[0];
  if(mode==='success'||mode==='sync'){
   assert.equal(output.status,0,output.stderr);assert.notEqual(actual,head);assert.equal(git('rev-parse',`${actual}^1`),head);assert.equal(git('rev-parse',`${actual}^2`),base);
   assert.equal(git('show',`${actual}:apps/web/src/app.js`),mode==='sync'?'const value=1;':'const value=3;');assert.equal(git('show',`${actual}:ci/control.mjs`),'trusted latest');
  }else{assert.notEqual(output.status,0);assert.equal(actual,head,'失敗時に公開先を更新してはいけません');}
 }finally{process.chdir(previous);await rm(root,{recursive:true,force:true});}
}
for(const mode of ['success','sync','stale','protected','unresolved'])test(`実Git公開処理: ${mode}（ローカルbare repoのみ）`,()=>run(mode));
