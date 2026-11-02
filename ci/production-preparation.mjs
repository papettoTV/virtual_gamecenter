// Build and package locally without deployment credentials or remote operations.
import {readFile,writeFile,mkdir,mkdtemp,symlink,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {checkReleaseConfig,checkBuildConfig} from '../apps/web/scripts/release-config.mjs';
import {checkPagesTargets} from '../apps/web/scripts/pages-targets.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const prod={worker:'pulbase-production',database:'af463342-06e5-4904-97fc-6569d59ceec3',bucket:'pulbase-production-deletion-audit'};
function need(v,m){if(!v)throw Error(m);}
export function configurationReport(config,targets,pages){
 const errors=[...checkReleaseConfig(config,'production'),...checkPagesTargets(targets,config)];
 const selected=config.env?.production;
 const remote=value=>value&&typeof value==='object'&&(value.remote===true||Object.values(value).some(remote));
 need(!remote(selected),'本番準備ではremote bindingを許可しません');
 need(errors.length===0,'本番の分離・安全設定が不合格です');
 need(config.account_id==='60e5472a284dc71bbafbbfac8aa2a940'&&selected.name===prod.worker
  &&selected.d1_databases?.find(x=>x.binding==='DB')?.database_id===prod.database
  &&selected.r2_buckets?.find(x=>x.binding==='DELETION_AUDIT')?.bucket_name===prod.bucket,'本番専用リソースの宣言が不一致です');
 need(pages.services?.length===1&&pages.services[0].binding==='BACKEND'&&pages.services[0].service===prod.worker
  &&pages.env?.preview?.services?.[0]?.service==='pulbase-staging','Pagesの本番/検証接続宣言が不一致です');
 need(selected.observability?.enabled===true&&selected.observability?.logs?.enabled===true&&selected.observability?.traces?.enabled===true,'本番のLogs/Traces宣言が必要です');
 return {configurationPassed:true,worker:prod.worker,databaseId:prod.database,bucket:prod.bucket,
  pagesProject:targets.project,pagesBranch:targets.production.branch,publicOrigin:'https://pulbase.com',
  remoteResourceExistenceVerified:false,productionReady:false};
}
export function isolatedEnvironment(scratch,sha,env=process.env){
 need(/^[a-f0-9]{40}$/.test(sha??''),'検証元のSHAが必要です');
 return {PATH:env.PATH,HOME:join(scratch,'home'),XDG_CONFIG_HOME:join(scratch,'config'),TMPDIR:join(scratch,'temp'),
  CI:'true',NO_COLOR:'1',WRANGLER_SEND_METRICS:'false',CLOUDFLARE_ENV:'production',PULBASE_RELEASE_SHA:sha,npm_config_update_notifier:'false'};
}
export function preparationCommands(web,scratch,node=process.execPath){
 return [{executable:'npm',args:['run','build:production'],cwd:web},
  {executable:node,args:['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--config','dist/virtual_gamecenter/wrangler.json','--outdir',join(scratch,'dry-run')],cwd:web}];
}
let stage='configuration';
async function main(){
 need(process.argv.length===3&&['inspect','build'].includes(process.argv[2]),'inspect/build以外は受け付けません');
 const read=async path=>JSON.parse(await readFile(resolve(root,path),'utf8'));
 const config=await read('apps/web/wrangler.jsonc'),targets=await read('apps/web/config/pages-targets.json'),pages=await read('apps/web/pages/wrangler.jsonc');
 const report={mode:'production-preparation-only',...configurationReport(config,targets,pages),
  buildPassed:false,workerDryRunPassed:false,remoteMigrationApplied:false,realRegressionExecuted:false,
  mainUpdated:false,deploymentRequested:false,workerUploaded:false,pagesUploaded:false,productionReady:false};
 if(process.argv[2]==='build'){
  const scratch=await mkdtemp(join(tmpdir(),'pulbase-production-prepare-'));
  try{
   const sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
   const env=isolatedEnvironment(scratch,sourceSha);
   for(const directory of ['home','config','temp','source'])await mkdir(join(scratch,directory));
   const archive=execFileSync('git',['archive','HEAD','apps/web'],{cwd:root,env,maxBuffer:128*1024*1024});
   execFileSync('tar',['-xf','-','-C',join(scratch,'source')],{input:archive,env});
   const web=join(scratch,'source/apps/web');
   await symlink(resolve(root,'apps/web/node_modules'),join(web,'node_modules'),'dir');
   const dummy='BASIC_AUTH_USERNAME=ci-example\nBASIC_AUTH_PASSWORD=ci-example\nGOOGLE_CLIENT_ID=ci-example.apps.googleusercontent.com\nGOOGLE_CLIENT_SECRET=ci-example\n';
   for(const name of ['.dev.vars','.dev.vars.production'])await writeFile(join(web,name),dummy,{flag:'wx',mode:0o600});
   stage='migration';const migration=JSON.parse(execFileSync('python3',[resolve(root,'tools/check-production-migrations.py')],{cwd:root,env,encoding:'utf8'}));
   need(migration.passed===true&&migration.remoteMigrationApplied===false,'ローカル移行リハーサルが不合格です');
   report.localMigration=migration;
   for(const [index,command] of preparationCommands(web,scratch).entries()){
    stage=index===0?'build':'worker-dry-run';execFileSync(command.executable,command.args,{cwd:command.cwd,env,stdio:'inherit',timeout:600000});
    if(index===0){
     const built=JSON.parse(await readFile(join(web,'dist/virtual_gamecenter/wrangler.json'),'utf8'));
     need(checkBuildConfig(built,config.env.production,'production').length===0,'本番成果物の設定が不一致です');
     report.buildPassed=true;
    }else report.workerDryRunPassed=true;
   }
   stage='browser-definition';const browserEnv={...env,PULBASE_BROWSER_ENVIRONMENT:'production',PULBASE_EXPECTED_SHA:sourceSha,PULBASE_CONFIRM_PRODUCTION:'true'};
   execFileSync(process.execPath,['ci/node_modules/@playwright/test/cli.js','test','--list','--config','ci/playwright.config.mjs'],{cwd:root,env:browserEnv,stdio:'inherit',timeout:60000});
   report.browserDefinitionsListed=true;report.sourceSha=sourceSha;
  }finally{await rm(scratch,{recursive:true,force:true});}
 }
 await mkdir(resolve(root,'ci/results'),{recursive:true});
 await writeFile(resolve(root,'ci/results/production-preparation.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(async()=>{await mkdir(resolve(root,'ci/results'),{recursive:true});await writeFile(resolve(root,'ci/results/production-preparation.json'),JSON.stringify({mode:'production-preparation-only',status:'failed',failureStage:stage,productionReady:false,deploymentRequested:false,mainUpdated:false,remoteMigrationApplied:false,realRegressionExecuted:false},null,2));console.error('本番の公開なし準備を停止しました。main・本番DB・Worker・Pagesは操作していません。');process.exitCode=1;});
