import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
test('起動定義はdevelopの初回成功CIだけを固定制御へ渡す',async()=>{
 const active=await readFile(new URL('../../.github/workflows/postmerge-staging-dispatch.yml',import.meta.url),'utf8');
 const w=parse(active);assert.deepEqual(w.on.workflow_run.workflows,['Web checks']);assert.deepEqual(w.on.workflow_run.branches,['develop']);assert.deepEqual(w.on.workflow_run.types,['requested','completed']);assert.equal(w.concurrency,undefined);
 assert.deepEqual(w.permissions,{contents:'read',actions:'write'});assert.ok(w.jobs.dispatch.if.includes("event == 'push'"));assert.equal(w.jobs.dispatch.environment,undefined);
 assert.ok(!active.includes('secrets.'));assert.ok(active.includes("ref:'ci-control'"));assert.ok(active.includes('postmerge-staging.yml/dispatches'));assert.ok(active.includes('EXPECTED_CONTROL_SHA'));
 const cleanup=w.jobs.dispatch.steps.find(s=>s.id==='cleanup');assert.equal(cleanup.run,'node ci/stale-staging-runs.mjs --apply > stale-staging-cleanup.json');
 assert.equal(cleanup['continue-on-error'],true);assert.equal(cleanup.env.GH_TOKEN,'${{ github.token }}');
 const dispatch=w.jobs.dispatch.steps.find(s=>s.name==='保護されたci-controlでマージ後の検証を起動');
 assert.ok(dispatch.if.includes("action == 'completed'"));assert.ok(dispatch.if.includes("conclusion == 'success'"));
 assert.ok(dispatch.run.includes("object?.sha!==process.env.SOURCE_SHA"));
 assert.ok(w.jobs.dispatch.steps.some(s=>s.if==="always() && steps.cleanup.outcome == 'failure'"));
});
