import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
test('staging承認ジョブ1つ、公開/回帰の実行ステップ1つ、実公開鍵は承認後の1stepだけ、共通ロックは制御側だけ',async()=>{
 const w=parse(await readFile(new URL('../../.github/workflow-templates/postmerge-staging.yml.disabled',import.meta.url),'utf8'));assert.deepEqual(w.permissions,{contents:'read',actions:'read'});assert.equal(w.jobs.staging.environment,"${{ inputs.publication == 'worker' && 'staging-worker' || 'staging' }}");
 assert.deepEqual(w.on.workflow_dispatch.inputs.publication.options,['disabled','pages','worker']);
 assert.equal(w.on.workflow_dispatch.inputs.publication.default,'disabled');assert.ok(!JSON.stringify(w.jobs.prepare).includes('secrets.'));
 const steps=w.jobs.staging.steps;const published=steps.filter(s=>s.run==='node ci/control/postmerge-runner.mjs approved');
 const [worker,approved]=published;
 assert.deepEqual(published.map(s=>s.if),["inputs.publication == 'worker'","inputs.publication == 'pages'"]);
 assert.deepEqual(Object.keys(worker.env).sort(),['CLOUDFLARE_WORKER_API_TOKEN','PULBASE_CHECK_PASSWORD','PULBASE_CHECK_USERNAME']);
 assert.equal(worker.env.CLOUDFLARE_WORKER_API_TOKEN,'${{ secrets.CLOUDFLARE_WORKER_API_TOKEN }}');
 assert.deepEqual(Object.keys(approved.env).sort(),['CLOUDFLARE_API_TOKEN','PULBASE_CHECK_PASSWORD','PULBASE_CHECK_USERNAME']);
 assert.equal(steps.filter(s=>JSON.stringify(s).includes('secrets.')).length,2);assert.ok(!JSON.stringify(w.jobs.staging.env).includes('secrets.'));
 const install=steps.findIndex(s=>s.run?.includes('install --with-deps chromium'));assert.ok(install>=0&&install<steps.indexOf(worker));assert.ok(!JSON.stringify(w).includes('review_run_id'));assert.equal(w.concurrency['cancel-in-progress'],false);
 assert.ok(w.jobs.staging.steps.some(s=>s.run==='npm ci --ignore-scripts --prefix ci/control/toolchain'));
 const runner=await readFile(new URL('../control/postmerge-runner.mjs',import.meta.url),'utf8');assert.ok(runner.includes("connectedStagingOperations({mode:'live'"));assert.ok(!runner.includes('PULBASE_PRODUCTION'));assert.ok(!runner.includes('process.env.RELEASE_MODE'));
 const d=parse(await readFile(new URL('../../.github/workflows/postmerge-staging-dispatch.yml',import.meta.url),'utf8'));assert.deepEqual(d.on.workflow_run.workflows,['Web checks']);assert.equal(d.concurrency,undefined);assert.ok(d.jobs.dispatch.if.includes("event == 'push'"));
});

test('公開用ツールのCIは鍵とEnvironmentなしで偽API・sandboxだけを検証する',async()=>{
 const w=parse(await readFile(new URL('../../.github/workflows/staging-toolchain-check.yml',import.meta.url),'utf8'));
 assert.deepEqual(w.permissions,{contents:'read'});assert.deepEqual(w.on.pull_request.branches,['develop']);assert.equal(w.jobs['verify-toolchain'].environment,undefined);assert.ok(!JSON.stringify(w).includes('secrets.'));assert.ok(JSON.stringify(w).includes('node tools/check-pages-metadata.mjs'));assert.ok(JSON.stringify(w).includes('chromiumSandbox:true'));
 assert.ok(w.jobs['verify-toolchain'].steps.some(s=>s.run==='node tools/check-browser-process.mjs'));
 const release=parse(await readFile(new URL('../../.github/workflow-templates/postmerge-staging.yml.disabled',import.meta.url),'utf8'));
 const steps=release.jobs.staging.steps;assert.ok(steps.findIndex(s=>s.run?.includes('chromiumSandbox:true'))<steps.findIndex(s=>s.run==='node ci/control/postmerge-runner.mjs approved'));
});

test('userns許可は固定Chromiumの実体だけで、ワイルドカードや任意実行ファイルを許可しない',async()=>{
 const {chromiumAppArmorProfile}=await import('../control/toolchain/prepare-browser-sandbox.mjs');
 const path='/home/runner/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';const profile=chromiumAppArmorProfile(path);assert.ok(profile.includes('"'+path+'"'));assert.ok(profile.includes('userns,'));assert.ok(!profile.includes('*'));assert.ok(!profile.includes('sysctl'));
 for(const value of ['/usr/bin/anything',path+'*',path+'"',path+'\n',path.replace('1228','*')])assert.throws(()=>chromiumAppArmorProfile(value));
});
