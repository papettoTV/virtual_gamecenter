import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
const flow=async name=>parse(await readFile(new URL(`../../.github/workflows/${name}`,import.meta.url),'utf8'));
test('develop登録定義にEnvironment・Secret・権限を渡さず必ず停止する',async()=>{
 const w=await flow('approved-candidate-evidence.yml');assert.deepEqual(w.permissions,{});assert.ok(w.on.workflow_dispatch.inputs.review_run_id.required);
 for(const j of Object.values(w.jobs)){assert.equal(j.environment,undefined);assert.ok(j.steps.some(s=>s.run?.includes('exit 1')));}
 assert.ok(!JSON.stringify(w).includes('secrets.'));
});
test('起動側は初回・固定SHAのci-controlだけを起動し、鍵と共通ロックを持たない',async()=>{
 const w=await flow('control-evidence-dispatch.yml'),s=JSON.stringify(w);
 assert.deepEqual(w.permissions,{contents:'read',actions:'write'});assert.equal(w.concurrency,undefined);assert.equal(w.jobs.dispatch.environment,undefined);
 assert.ok(w.jobs.dispatch.if.includes("PULBASE_CONTROL_EVIDENCE_ENABLED == 'true'"));assert.ok(!s.includes('secrets.'));assert.ok(s.includes("ref:'ci-control'"));
 assert.ok(s.includes('EXPECTED_CONTROL_SHA'));assert.ok(s.includes("SOURCE_ATTEMPT !== '1'"));assert.ok(s.includes("THIS_ATTEMPT !== '1'"));
 assert.ok(s.includes('actions/workflows/approved-candidate-evidence.yml/dispatches'));
});
test('保護制御を有効にしたら旧develop検証は起動せず、二重起動を避ける',async()=>{
 const old=await flow('candidate-evidence.yml');assert.ok(old.jobs.evidence.if.includes("PULBASE_CONTROL_EVIDENCE_ENABLED != 'true'"));
});
