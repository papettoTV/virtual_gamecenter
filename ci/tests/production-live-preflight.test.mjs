import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { packProductionBundle, verifyProductionBundle } from '../production-candidate/build-bundle.mjs';
import { verifyProductionApproval } from '../production-candidate/approval.mjs';

const repository = 'papettoTV/virtual_gamecenter';
const scope = { revision:'a'.repeat(40), tree:'b'.repeat(40), run:'123', attempt:'1' };
const context = { repository, ref:'refs/heads/ci-control', event:'workflow_dispatch', attempt:'1', runId:'123', controlSha:'c'.repeat(40) };
const runPath = 'actions/runs/123';
const envPath = 'environments/production';
const policyPath = envPath + '/deployment-branch-policies?per_page=100';

function fixture() {
  const data = {
    [runPath]:{ id:123, head_sha:context.controlSha, head_repository:{full_name:repository}, head_branch:'ci-control',
      path:'.github/workflows/production-approved-release.yml', event:'workflow_dispatch', run_attempt:1, status:'in_progress' },
    [envPath]:{ id:100, name:'production', can_admins_bypass:false, deployment_branch_policy:{custom_branch_policies:true,protected_branches:false},
      protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{login:'papettoTV'}}]}] },
    [policyPath]:{ total_count:1, branch_policies:[{type:'branch', name:'ci-control'}] },
    [runPath+'/approvals']:[{state:'approved',user:{login:'papettoTV'},environments:[{id:100,name:'production'}]}],
    'git/ref/heads/ci-control':{object:{sha:context.controlSha}},
  };
  return {data, context:{...context}, api:async path=>data[path]};
}

test('保護された初回runに記録されたproductionの人による承認1件を確認',async()=>{
  assert.deepEqual(await verifyProductionApproval(fixture()),{runId:'123',controlSha:context.controlSha,environment:'production',approvalCount:1});
});

test('予行承認、別ユーザー、複数承認、別ブランチ、管理者bypass、再実行を拒否',async()=>{
  for(const change of [
    f=>{f.data[runPath+'/approvals'][0].environments[0].name='production-rehearsal';},
    f=>{f.data[runPath+'/approvals'][0].user.login='github-actions[bot]';},
    f=>{f.data[runPath+'/approvals'].push(f.data[runPath+'/approvals'][0]);},
    f=>{f.data[policyPath].branch_policies[0].name='main';},
    f=>{f.data[envPath].can_admins_bypass=true;},
    f=>{f.data[runPath].run_attempt=2;},
    f=>{f.context.ref='refs/heads/develop';},
    f=>{f.data['git/ref/heads/ci-control'].object.sha=scope.tree;},
  ]) { const f=fixture();change(f);await assert.rejects(verifyProductionApproval(f)); }
});

async function bundleFixture(t) {
  const tmp = await mkdtemp(join(tmpdir(),'production-bundle-test-'));
  t.after(()=>rm(tmp,{force:true,recursive:true}));
  const webRoot=join(tmp,'web'), directory=join(tmp,'artifact');
  const entries={
    'dist/virtual_gamecenter/index.js':'const revision="'+scope.revision+'";',
    'dist/virtual_gamecenter/wrangler.json':'{"build":{"command":"do not copy"}}',
    'dist/virtual_gamecenter/.vite/manifest.json':'{}',
    'dist/client/_worker.js':'const revision="'+scope.revision+'";',
    'dist/client/_routes.json':'{}',
    'dist/client/.assetsignore':'_worker.js',
    'migrations/0001_schema.sql':'CREATE TABLE t (id INTEGER);',
  };
  for(const [path,contents] of Object.entries(entries)) {
    await mkdir(dirname(join(webRoot,path)),{recursive:true});
    await writeFile(join(webRoot,path),contents);
  }
  return {webRoot,directory,...scope};
}

test('本番成果物を固定し、候補側のWrangler設定を渡さず同じハッシュで照合',async t=>{
  const f=await bundleFixture(t), bundle=await packProductionBundle(f);
  assert.equal(bundle.fileCount,5);
  assert.deepEqual(await verifyProductionBundle({...f,expectedDigest:bundle.manifestDigest}),bundle);
  await assert.rejects(verifyProductionBundle({...f,expectedDigest:'1'.repeat(64)}));
  await assert.rejects(verifyProductionBundle({...f,attempt:'2'}));
  await writeFile(join(f.directory,'worker/index.js'),'changed');
  await assert.rejects(verifyProductionBundle({...f,expectedDigest:bundle.manifestDigest}));
});

test('Secretファイル、シンボリックリンク、SHA刻印なしを拒否',async t=>{
  for(const adversary of [
    f=>writeFile(join(f.webRoot,'dist/virtual_gamecenter/.dev.vars'),'test-only'),
    f=>symlink(join(f.webRoot,'dist/client/_worker.js'),join(f.webRoot,'dist/client/link.js')),
    f=>writeFile(join(f.webRoot,'dist/client/_worker.js'),'other version'),
  ]) { const f=await bundleFixture(t);await adversary(f);await assert.rejects(packProductionBundle(f)); }
});
