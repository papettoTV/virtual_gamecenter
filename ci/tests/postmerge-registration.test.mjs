import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
const flow=async name=>parse(await readFile(new URL(`../../.github/workflows/${name}`,import.meta.url),'utf8'));
test('新しいマージ後登録定義は権限なし・Environmentなしで必ず停止',async()=>{
 const w=await flow('postmerge-staging.yml');assert.deepEqual(w.permissions,{});assert.ok(w.on.workflow_dispatch.inputs.ci_run_id.required);assert.equal(w.jobs['registration-only'].environment,undefined);assert.ok(w.jobs['registration-only'].steps[0].run.includes('exit 1'));
});
