import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
import {configurationReport,isolatedEnvironment,preparationCommands} from '../production-preparation.mjs';
const load=async path=>JSON.parse(await readFile(new URL('../../'+path,import.meta.url),'utf8'));
const config=await load('apps/web/wrangler.jsonc'),targets=await load('apps/web/config/pages-targets.json'),pages=await load('apps/web/pages/wrangler.jsonc');
test('本番の分離宣言と公開無効を確認しても、実リソースや公開可能とは判定しない',()=>{
 const result=configurationReport(config,targets,pages);assert.equal(result.configurationPassed,true);assert.equal(result.productionReady,false);assert.equal(result.remoteResourceExistenceVerified,false);
 for(const mutate of [c=>c.env.production.name='pulbase-staging',c=>c.env.production.d1_databases[0].database_id=config.env.staging.d1_databases[0].database_id,
  c=>c.env.production.r2_buckets[0].bucket_name=config.env.staging.r2_buckets[0].bucket_name,c=>c.env.production.workers_dev=true,c=>c.env.production.d1_databases[0].remote=true,c=>c.env.production.observability.traces.enabled=false]){
  const c=structuredClone(config);mutate(c);assert.throws(()=>configurationReport(c,targets,pages));
 }
 const p=structuredClone(pages);p.services[0].service='pulbase-staging';assert.throws(()=>configurationReport(config,targets,p));
});
test('buildとdry-runへGitHub/Cloudflare/OpenAI鍵・本番Basic・既存HOMEを継承しない',()=>{
 const fake={PATH:'/example',HOME:'/real-home',CLOUDFLARE_API_TOKEN:'private-cf',GH_TOKEN:'private-gh',OPENAI_API_KEY:'private-openai',PULBASE_CHECK_PASSWORD:'private-password',NODE_OPTIONS:'--require private.js'};
 const env=isolatedEnvironment('/scratch','a'.repeat(40),fake);
 assert.equal(env.HOME,'/scratch/home');assert.equal(env.XDG_CONFIG_HOME,'/scratch/config');assert.ok(!JSON.stringify(env).includes('private-'));assert.ok(!JSON.stringify(env).includes('/real-home'));
 assert.equal(env.CLOUDFLARE_ENV,'production');assert.throws(()=>isolatedEnvironment('/scratch','main',fake));
});
test('公開なしコマンドはbuildとdry-runだけで、remote移行・Pages公開・Secret登録を含まない',()=>{
 const commands=preparationCommands('/web','/scratch','/node');assert.equal(commands.length,2);assert.deepEqual(commands[0].args,['run','build:production']);
 assert.ok(commands[1].args.includes('--dry-run'));assert.ok(!JSON.stringify(commands).includes('--remote'));assert.ok(!JSON.stringify(commands).includes('secret'));assert.ok(!JSON.stringify(commands).includes('pages'));
});
test('本番準備workflowはEnvironment・Secret・書込権限を持たず、成果物は結果JSONだけ',async()=>{
 const raw=await readFile(new URL('../../.github/workflows/production-preparation.yml',import.meta.url),'utf8'),w=parse(raw);
 assert.deepEqual(w.permissions,{contents:'read'});assert.equal(w.jobs.prepare.environment,undefined);assert.ok(!raw.includes('secrets.'));assert.ok(!raw.includes('PULBASE_PRODUCTION_ENABLED'));
 assert.deepEqual(w.on.pull_request.branches,['develop']);assert.equal(w.jobs.prepare.steps.at(-1).with.path,'ci/results/production-preparation.json');
 assert.ok(w.jobs.prepare.steps.some(s=>s.run==='node ci/production-preparation.mjs build'));
});
