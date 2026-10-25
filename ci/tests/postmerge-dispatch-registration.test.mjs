import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
test('有効化する起動定義はレビュー済み原本と一致し、developの初回成功CIだけを固定制御へ渡す',async()=>{
 const active=await readFile(new URL('../../.github/workflows/postmerge-staging-dispatch.yml',import.meta.url),'utf8');
 assert.equal(active,await readFile(new URL('../../.github/workflow-templates/postmerge-dispatch.yml.disabled',import.meta.url),'utf8'));
 const w=parse(active);assert.deepEqual(w.on.workflow_run.workflows,['Web checks']);assert.deepEqual(w.on.workflow_run.branches,['develop']);assert.equal(w.concurrency,undefined);
 assert.deepEqual(w.permissions,{contents:'read',actions:'write'});assert.ok(w.jobs.dispatch.if.includes("event == 'push'"));assert.equal(w.jobs.dispatch.environment,undefined);
 assert.ok(!active.includes('secrets.'));assert.ok(active.includes("ref:'ci-control'"));assert.ok(active.includes('postmerge-staging.yml/dispatches'));assert.ok(active.includes('EXPECTED_CONTROL_SHA'));
});
