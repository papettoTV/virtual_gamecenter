// Preparation only: no default live transport, no CLI entry point, no credential discovery.
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {checkBuild} from './candidate-evidence.mjs';
const account='60e5472a284dc71bbafbbfac8aa2a940';
const keys=['account_id','compatibility_date','compatibility_flags','migrations','name','no_bundle','workers_dev','preview_urls','routes','assets','observability','triggers','vars','secrets','durable_objects','d1_databases','r2_buckets','ratelimits','analytics_engine_datasets'];
function need(v,m){if(!v)throw Error(m);}
function freeze(x){if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
export function validateStagingTarget(t){
 need(t.account_id===account&&t.name==='pulbase-staging'&&t.no_bundle===true&&t.workers_dev===false&&t.preview_urls===false
  &&Array.isArray(t.routes)&&!t.routes.length&&t.vars?.APP_ENV==='staging'
  &&t.vars.DEVELOPER_AUTH_ENABLED==='false'&&t.vars.CREDIT_PURCHASES_ENABLED==='false'
  &&t.d1_databases?.length===1&&t.d1_databases[0].database_name==='pulbase-staging'
  &&t.r2_buckets?.length===1&&t.r2_buckets[0].bucket_name==='pulbase-staging-deletion-audit'
  &&Object.keys(t).every(k=>keys.includes(k)),'staging以外の公開設定・build hookを拒否');
}
export function assertStagingPages(project){
 need(project?.name==='virtual-gamecenter'&&project.production_branch==='main','Pagesの公開先が不一致');
 const c=project.source?.config;
 need(!project.source||c?.deployments_enabled===false||(c?.preview_deployment_setting==='none'&&c?.production_deployments_enabled===false),'PagesのGit自動公開が停止していません');
}
export async function prepareStagingPublication(directory,receipt,{scratch=tmpdir()}={}){
 need(/^[a-f0-9]{40}$/.test(receipt?.candidate??'')&&/^[a-f0-9]{40}$/.test(receipt?.tree??''),'公開SHA不正');
 const files=await checkBuild(directory,receipt);
 const target=JSON.parse(await readFile(new URL('./staging-target.json',import.meta.url),'utf8'));validateStagingTarget(target);
 const gateway=(await readFile(new URL('./staging-gateway.mjs',import.meta.url),'utf8')).replace('__PULBASE_GATEWAY_REVISION__',receipt.candidate);
 need((await readFile(join(directory,'client/_worker.js'),'utf8'))===gateway,'固定ゲートウェイとの不一致');
 const prepared=await mkdtemp(join(scratch,'pulbase-fixed-staging-'));await mkdir(join(prepared,'pages'));
 const config={...target,main:resolve(directory,'worker/index.js'),assets:{...target.assets,directory:resolve(directory,'client')}};
 await writeFile(join(prepared,'worker.json'),JSON.stringify(config));
 const bindings={vars:{APP_ENV:'staging'},services:[{binding:'BACKEND',service:'pulbase-staging'}]};
 const pages={name:'virtual-gamecenter',compatibility_date:target.compatibility_date,pages_build_output_dir:resolve(directory,'client'),...bindings,env:{preview:bindings}};
 await writeFile(join(prepared,'pages/wrangler.jsonc'),JSON.stringify(pages));
 return freeze({version:1,environment:'staging',account,worker:'pulbase-staging',project:'virtual-gamecenter',branch:'develop',sha:receipt.candidate,
  artifact:resolve(directory),receipt:structuredClone(receipt),files,prepared,workerConfig:join(prepared,'worker.json'),pagesDirectory:join(prepared,'pages')});
}
export function publicationCommands(plan){
 need(plan.environment==='staging'&&plan.account===account&&plan.worker==='pulbase-staging'&&plan.project==='virtual-gamecenter'&&plan.branch==='develop'&&/^[a-f0-9]{40}$/.test(plan.sha),'公開計画の不一致');
 return {worker:['deploy','--config',plan.workerConfig,'--no-bundle','--autoconfig=false'],
  pages:['pages','deploy',join(plan.artifact,'client'),'--cwd',plan.pagesDirectory,'--project-name','virtual-gamecenter','--branch','develop','--commit-hash',plan.sha,'--commit-dirty=true','--no-bundle']};
}
export class PublicationStopped extends Error{
 constructor(phase,workerOutcome){super('staging公開を停止しました。部分反映の可能性を確認してください。');this.phase=phase;this.workerOutcome=workerOutcome;}
}
export async function executeStagingPublication(plan,{guard,transport}={}){
 need(typeof guard==='function'&&typeof transport?.project==='function'&&typeof transport.execute==='function','保護されたguardと明示transportが必要');
 let phase='preflight',workerOutcome='not-attempted';
 const commands=publicationCommands(plan);
 async function recheck(){await checkBuild(plan.artifact,plan.receipt);await guard();}
 try{
  await recheck();const before=await transport.project();assertStagingPages(before);
  await recheck();phase='worker';workerOutcome='unknown';await transport.execute(commands.worker,{cwd:plan.prepared});workerOutcome='uploaded';
  await recheck();assertStagingPages(await transport.project());phase='pages';await transport.execute(commands.pages,{cwd:plan.prepared});
  const after=await transport.project();assertStagingPages(after);
  need(JSON.stringify(before.source)===JSON.stringify(after.source)&&JSON.stringify(before.build_config)===JSON.stringify(after.build_config),'Pages設定が変わりました。自動修復せず停止');
  await recheck();return {passed:true,environment:'staging',sha:plan.sha,files:plan.files};
 }catch{throw new PublicationStopped(phase,workerOutcome);}
}
export async function dryRunStaging(plan,command){
 need(typeof command==='function','dry-run commandが必要');
 await checkBuild(plan.artifact,plan.receipt);
 const args=[...publicationCommands(plan).worker,'--dry-run','--outdir',join(plan.prepared,'dry-run')];
 // Credentials and candidate environment variables are never inherited.
 await command(args,{cwd:plan.prepared,env:{PATH:process.env.PATH,CI:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'}});
 return {mode:'wrangler-dry-run',sha:plan.sha,workerUploaded:false,pagesUploaded:false};
}
