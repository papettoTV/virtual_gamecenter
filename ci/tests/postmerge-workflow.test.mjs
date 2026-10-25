import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
test('staging承認ジョブ1つ、公開/回帰の実行ステップ1つ、鍵なし、共通ロックは制御側だけ',async()=>{
 const w=parse(await readFile(new URL('../../.github/workflow-templates/postmerge-staging.yml.disabled',import.meta.url),'utf8'));assert.deepEqual(w.permissions,{contents:'read',actions:'read'});assert.equal(Object.values(w.jobs).filter(j=>j.environment==='staging').length,1);
 assert.equal(w.jobs.staging.steps.filter(s=>s.run==='node ci/control/postmerge-runner.mjs approved').length,1);assert.ok(!JSON.stringify(w).includes('secrets.'));assert.ok(!JSON.stringify(w).includes('review_run_id'));assert.equal(w.concurrency['cancel-in-progress'],false);
 assert.ok(w.jobs.staging.steps.some(s=>s.run==='npm ci --ignore-scripts --prefix ci/control/toolchain'));
 const runner=await readFile(new URL('../control/postmerge-runner.mjs',import.meta.url),'utf8');assert.ok(runner.includes("connectedStagingOperations({mode:'keyless'"));assert.ok(!runner.includes('process.env.CLOUDFLARE_API_TOKEN'));
 const d=parse(await readFile(new URL('../../.github/workflow-templates/postmerge-dispatch.yml.disabled',import.meta.url),'utf8'));assert.deepEqual(d.on.workflow_run.workflows,['Web checks']);assert.equal(d.concurrency,undefined);assert.ok(d.jobs.dispatch.if.includes("event == 'push'"));
});
