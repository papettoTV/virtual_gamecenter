import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {prepareRepairWorkspace} from '../repair-workspace.mjs';
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function fixture(fn){const previous=process.cwd(),dir=await mkdtemp(join(tmpdir(),'repair-workspace-'));try{
 process.chdir(dir);git('init','-b','develop');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('config','commit.gpgsign','false');
 await mkdir('apps/web/src',{recursive:true});await mkdir('ci');await writeFile('apps/web/src/app.js','const value = 0;\n');await writeFile('ci/protected.mjs','export const version=1;\n');git('add','.');git('commit','-m','base');const old=git('rev-parse','HEAD');
 git('checkout','-b','codex/issue-1');await writeFile('apps/web/src/app.js','const value = 1;\n');git('add','.');git('commit','-m','application');const head=git('rev-parse','HEAD');
 git('checkout','develop');await writeFile('ci/protected.mjs','export const version=2;\n');git('add','.');git('commit','-m','trusted control');await fn({dir,old,head,base:git('rev-parse','HEAD')});
 }finally{process.chdir(previous);await rm(dir,{recursive:true,force:true});}}
test('同期候補に最新制御を保持し、PRのアプリ変更だけを残す',()=>fixture(async({head,base})=>{
 git('checkout','--detach',head);const result=prepareRepairWorkspace({head,base});assert.deepEqual(result.conflicts,[]);
 assert.equal(await readFile('ci/protected.mjs','utf8'),'export const version=2;\n');assert.equal(await readFile('apps/web/src/app.js','utf8'),'const value = 1;\n');
 assert.equal(git('rev-parse','HEAD^1'),head);assert.equal(git('rev-parse','HEAD^2'),base);assert.equal(git('rev-parse',`HEAD:ci/protected.mjs`),git('rev-parse',`${base}:ci/protected.mjs`));
}));
test('アプリ競合だけを隔離候補へ渡し、公開用ブランチを更新しない',()=>fixture(async({head})=>{
 await writeFile('apps/web/src/app.js','const value = 2;\n');git('add','.');git('commit','-m','other application');const base=git('rev-parse','HEAD');git('checkout','--detach',head);
 const result=prepareRepairWorkspace({head,base});assert.deepEqual(result.conflicts,['apps/web/src/app.js']);assert.match(await readFile('apps/web/src/app.js','utf8'),/<<<<<<< /);assert.equal(git('rev-parse','codex/issue-1'),head);
}));
test('保護定義を改変したPRと変更されたheadを拒否',()=>fixture(async({head,base})=>{
 git('checkout','codex/issue-1');await writeFile('ci/protected.mjs','unsafe\n');git('add','.');git('commit','-m','attempt control change');const modified=git('rev-parse','HEAD');
 assert.throws(()=>prepareRepairWorkspace({head:modified,base}),/protected path/);assert.throws(()=>prepareRepairWorkspace({head,base}),/head/);
}));
