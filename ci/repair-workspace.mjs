// Loaded only from the trusted develop commit, before the isolated agent runs.
import {execFileSync,spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {assertChanges,assertSha,allowedPath} from './policy.mjs';
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
export function prepareRepairWorkspace({head,base}){
 assertSha(head);assertSha(base);if(git('rev-parse','HEAD')!==head)throw Error('修正workspaceのhead不一致');
 const ancestor=git('merge-base',head,base);
 const changed=git('diff','--name-only','-z',ancestor,head).split('\0').filter(Boolean);assertChanges(changed.map(filename=>({filename})));
 git('config','user.name','Pulbase Automation');git('config','user.email','pulbase-automation@users.noreply.github.com');
 const merged=spawnSync('git',['-c','core.hooksPath=/dev/null','merge','--no-commit','--no-ff',base],{encoding:'utf8'});
 if(![0,1].includes(merged.status))throw Error('developの同期に失敗しました');
 const conflicts=git('diff','--name-only','--diff-filter=U','-z').split('\0').filter(Boolean);
 if(conflicts.some(x=>!allowedPath(x)))throw Error('保護ファイルの競合は人による確認が必要です');
 if(conflicts.length)git('add','--',...conflicts);
 const files=git('diff','--cached','--name-only','-z',base).split('\0').filter(Boolean);assertChanges(files.map(filename=>({filename})));
 const raw=git('diff','--cached','--raw','--no-abbrev',base);
 if(raw.split('\n').some(l=>l&&!/^:(?:000000|100644) (?:000000|100644) /.test(l)))throw Error('同期候補は通常ファイルだけです');
 // A local synthetic base with conflict markers, never pushed to GitHub.
 const tree=git('write-tree');const commit=execFileSync('git',['-c','core.hooksPath=/dev/null','commit-tree',tree,'-p',head,'-p',base,'-m','隔離修正用の一時候補（公開禁止）'],{encoding:'utf8'}).trim();
 git('reset','--hard',commit);
 return {tree,head,base,conflicts,files};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  git('fetch','--no-tags','origin',assertSha(process.env.TRUSTED_BASE_SHA));
  const info=prepareRepairWorkspace({head:assertSha(process.env.PR_HEAD_SHA),base:assertSha(process.env.TRUSTED_BASE_SHA)});
  await writeFile('ci/repair-context.json',JSON.stringify(info));
 }catch{console.error('修正workspaceを準備できません。保護対象・head/base・競合範囲を確認してください。');process.exitCode=1;}
}
