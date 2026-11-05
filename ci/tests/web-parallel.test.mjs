import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';
import {checkWebWorkflow} from '../check-workflows.mjs';
const workflow=parse(await readFile(new URL('../../.github/workflows/web-checks.yml',import.meta.url),'utf8'));
test('PC・スマホの並列検査と全成功後の成果物作成を固定',()=>checkWebWorkflow(workflow));
test('片方の省略・失敗無視・早すぎる成果物作成を拒否',()=>{
 for(const mutate of [w=>w.jobs.verify.needs=['unit'],w=>w.jobs.verify.if=undefined,w=>w.jobs.ui.strategy.matrix.project=['desktop'],w=>w.jobs.ui.strategy['fail-fast']=true,w=>w.jobs.ui['continue-on-error']=true,w=>w.jobs.verify.steps.find(s=>s.env?.UNIT_RESULT).run='true',w=>w.jobs.verify.steps.find(s=>s.run==='node ci/staging-artifact.mjs').if='always()',w=>w.jobs.unit.steps.find(s=>s.run==='npm test').run='echo skipped']){
  const copy=structuredClone(workflow);mutate(copy);assert.throws(()=>checkWebWorkflow(copy));
 }
});
test('失敗・取消・省略されたunit/UIはすべて最終gateで拒否',()=>{
 const command=workflow.jobs.verify.steps.find(s=>s.env?.UNIT_RESULT).run;
 for(const unit of ['success','failure','cancelled','skipped'])for(const ui of ['success','failure','cancelled','skipped']){
  const result=spawnSync('sh',['-c',command],{env:{...process.env,UNIT_RESULT:unit,UI_RESULT:ui}});
  assert.equal(result.status===0,unit==='success'&&ui==='success',`${unit}/${ui}`);
 }
});
