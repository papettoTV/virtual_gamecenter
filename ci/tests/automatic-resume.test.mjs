import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {allowedPath} from '../policy.mjs';
import {resumeTarget,assertResumeSnapshot} from '../automatic-resume.mjs';
import {discoverUiTests,localUiUrl} from '../ui-tests.mjs';
import {intake} from '../github.mjs';
const repository='papettoTV/virtual_gamecenter',repo={owner:'papettoTV',repo:'virtual_gamecenter'},base='a'.repeat(40),head='b'.repeat(40),candidate='c'.repeat(40),bot='pulbase-codex[bot]';
function fixture(){
 const issue={state:'open',labels:['実装:自動']},pr={number:83,user:{login:bot},state:'open',draft:false,mergeable:true,merge_commit_sha:candidate,
  base:{ref:'develop',sha:base,repo:{full_name:repository}},head:{ref:'codex/issue-82',sha:head,repo:{full_name:repository}}};
 const list=()=>{},files=()=>{};
 const github={rest:{pulls:{list,listFiles:files,get:async()=>({data:pr})},issues:{get:async()=>({data:issue})}},
  paginate:async method=>method===list?[pr]:[{filename:'apps/web/src/games/dot-wave/duel/style.css'}]};
 return {issue,pr,github};
}
test('自動再開もアプリコード全般を許可し、公開制御の保護は維持する',()=>{
 for(const path of ['apps/web/src/features/analytics/AnalyticsConsent.tsx','apps/web/src/features/platform/PlatformExperience.tsx','apps/web/tests/platform/credit.test.ts','apps/web/tests/ui/auth.spec.mjs','apps/web/src/worker/platform.ts','apps/web/src/games/graze-duel/input.js'])assert.equal(allowedPath(path),true,path);
 for(const path of ['ci/policy.mjs','.github/workflows/codex-issue.yml','apps/web/src/pages/gateway.mjs','apps/web/public/_worker.js','apps/web/tests/platform/leave-game.test.ts.bak','apps/web/src/features/analytics/../analytics/analytics-consent.css'])assert.equal(allowedPath(path),false,path);
});
test('既存の自動PRだけを再開し、別PR・担当変更・古いbase・未確定候補を拒否する',async()=>{
 const f=fixture(),target=await resumeTarget({github:f.github,repo,issueNumber:82,bot,base});
 assert.deepEqual(target,{pull:'83',head,candidate});
 for(const change of [f=>f.issue.labels=['実装:手元'],f=>f.pr.base.sha=head,f=>f.pr.mergeable=null,f=>f.pr.user.login='other',f=>f.pr.head.ref='manual/issue-82',f=>f.pr.head.repo.full_name='attacker/repo']){
  const f=fixture();change(f);await assert.rejects(resumeTarget({github:f.github,repo,issueNumber:82,bot,base}));
 }
});
test('公開直前も同じhead/base/PR/候補だけを許可する',()=>{
 const f=fixture(),expected={issue:82,pull:83,head,candidate,trustedBase:base,bot,repository};
 assert.equal(assertResumeSnapshot(f.pr,expected),true);
 for(const patch of [{head:base},{trustedBase:head},{pull:84},{candidate:head},{issue:81}])assert.throws(()=>assertResumeSnapshot(f.pr,{...expected,...patch}));
});
test('再開受付は実装を既存PR候補、公開処理を信頼されたdevelopへ固定する',async()=>{
 const f=fixture();f.issue.user={login:'papettoTV'};f.issue.title='表示調整';f.issue.body='要件';
 f.github.rest.repos={getCollaboratorPermissionLevel:async()=>({data:{permission:'write'}}),getBranch:async()=>({data:{commit:{sha:base}}})};
 const outputs={},context={repo,actor:'papettoTV',eventName:'issues',payload:{issue:{number:82},action:'labeled',label:{name:'実装:再開'}}};
 await intake({github:f.github,context,core:{setOutput:(k,v)=>outputs[k]=v},bot});
 assert.equal(outputs.base,candidate);assert.equal(outputs.trusted_base,base);assert.equal(outputs.pull,'83');assert.equal(outputs.head,head);
 context.payload.label.name='実装:自動';await assert.rejects(intake({github:f.github,context,core:{setOutput(){}},bot}));
});
test('UI検査は固定ループバックだけを使用する',()=>{
 assert.equal(localUiUrl('http://127.0.0.1:5174/'),true);assert.equal(localUiUrl('ws://127.0.0.1:5174/api/live'),true);
 for(const url of ['https://pulbase.com/','https://develop.virtual-gamecenter.pages.dev/','http://127.0.0.1:9999/','http://user:pass@127.0.0.1:5174/','file:///tmp/page'])assert.equal(localUiUrl(url),false);
});
test('UIケース探索はspecだけ、シンボリックリンクや過大ファイルは拒否する',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pulbase-ui-tests-'));try{
  assert.deepEqual(await discoverUiTests(join(root,'missing')),[]);
  await writeFile(join(root,'layout.spec.mjs'),'// case');await writeFile(join(root,'notes.md'),'notes');
  assert.deepEqual(await discoverUiTests(root),['layout.spec.mjs']);
  await symlink(join(root,'layout.spec.mjs'),join(root,'linked.spec.mjs'));await assert.rejects(discoverUiTests(root));
  await rm(join(root,'linked.spec.mjs'));await writeFile(join(root,'large.spec.mjs'),'x'.repeat(90001));await assert.rejects(discoverUiTests(root));
 }finally{await rm(root,{recursive:true,force:true});}
});
