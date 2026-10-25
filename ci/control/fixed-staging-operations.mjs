import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {prepareStagingPublication,publicationCommands,executeStagingPublication,dryRunStaging,PUBLICATION_STOP_REASONS} from './staging-publication.mjs';
import {stagingRegression} from './staging-regression.mjs';
import {assertReleaseObservation} from './postmerge-staging.mjs';
import {runFixedTool,runFixedBrowser,publicToolEnvironment,sanitizeCommandFailure} from './fixed-process.mjs';
const endpoint='https://api.cloudflare.com/client/v4/accounts/60e5472a284dc71bbafbbfac8aa2a940/pages/projects/virtual-gamecenter';
const projectFixture=()=>({name:'virtual-gamecenter',production_branch:'main',source:{config:{preview_deployment_setting:'none',production_deployments_enabled:false}},build_config:{mode:'keyless-simulated',destination_dir:'dist/client'}});
function need(v,m){if(!v)throw Error(m);}
export async function connectedStagingOperations({mode,scope,execution,artifactDirectory,guard,credentials={},ports={}}){
 need(['keyless','live'].includes(mode)&&typeof guard==='function','明示モードと保護guardが必要');
 if(mode==='live')need(credentials.cloudflareToken&&credentials.username&&credentials.password,'liveには別途登録する検証用認証が必要');
 // Keyless mode deliberately ignores any credentials accidentally supplied by a caller.
 const secrets=mode==='live'?credentials:{};
 const command=ports.process??runFixedTool,request=ports.request??fetch;
 const expected=scope.evidence,receipt={candidate:expected.sha,tree:expected.tree,buildRun:expected.runId,buildAttempt:expected.attempt};
 const plan=await prepareStagingPublication(artifactDirectory,receipt);
 const commands=publicationCommands(plan),audit=[];let regressionCompleted=false,httpAttempted=false,browserAttempted=false;
 const outcomes={worker:'not-attempted',pages:'not-attempted'};let commandFailure=null,publicationStopReason=null;
 async function authorize(){
  const observation=await guard();assertReleaseObservation(scope,execution,observation);
  need(createHash('sha256').update(await readFile(join(plan.artifact,'manifest.json'))).digest('hex')===scope.manifestDigest,'承認されたmanifestが変更されました');
 }
 const transport={
  project:async()=>{
   if(mode==='keyless')return projectFixture();
   let r;try{r=await request(endpoint,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${secrets.cloudflareToken}`},signal:AbortSignal.timeout(15000)});
    if(!r.ok){await r.body?.cancel();throw Error();}const data=await r.json();need(data.success===true,'Pages不合格');return data.result;
   }catch{throw Error('固定Pages設定を読み取れません。応答・認証値は表示しません');}
  },
  execute:async(args,options)=>{
   const phase=JSON.stringify(args)===JSON.stringify(commands.worker)?'worker':JSON.stringify(args)===JSON.stringify(commands.pages)?'pages':null;
   need(phase,'固定された公開命令以外は拒否');
   if(mode==='keyless'){
    if(phase==='worker')await dryRunStaging(plan,async(a,o)=>{const r=await command('wrangler',a,o);need(r.exitCode===0,'Worker dry-run失敗');});
    audit.push({tool:'wrangler',phase,simulatedWrite:true,workerDryRunExecuted:phase==='worker'});return;
   }
   const env={...publicToolEnvironment(),CLOUDFLARE_ACCOUNT_ID:'60e5472a284dc71bbafbbfac8aa2a940',CLOUDFLARE_API_TOKEN:secrets.cloudflareToken};
   outcomes[phase]='unknown';
   const r=await command('wrangler',args,{...options,env,timeout:240000});if(r.exitCode!==0)commandFailure=sanitizeCommandFailure({phase,exitCode:r.exitCode,...r.diagnostics});need(r.exitCode===0,'固定されたstaging公開命令が不合格');
   outcomes[phase]='uploaded';audit.push({tool:'wrangler',phase,realWrite:true});
  },
 };
 return {
  publish:async()=>{try{return await executeStagingPublication(plan,{guard:authorize,transport});}catch(e){publicationStopReason=PUBLICATION_STOP_REASONS.includes(e.stopReason)?e.stopReason:'unknown';throw e;}},
  regress:async()=>{const result=await stagingRegression(expected.sha,{guard:authorize,credentials:mode==='live'?{username:secrets.username,password:secrets.password}:{},validationOnly:mode==='keyless',
   request:mode==='live'?async(url,opts)=>{httpAttempted=true;return request(url,opts);}:async(url,opts)=>{
    need(url===`https://develop.virtual-gamecenter.pages.dev/?release-check=${expected.sha}`&&opts.method==='GET'&&opts.redirect==='manual','HTTPの固定要求不一致');
    audit.push({phase:'http',simulated:true});return new Response('',{headers:{'x-pulbase-revision':expected.sha,'x-pulbase-gateway-revision':expected.sha}});
   },
   browser:async options=>{browserAttempted=true;const r=await runFixedBrowser({...options,listOnly:mode==='keyless',process:command});audit.push({phase:'browser',listOnly:mode==='keyless',declaredTests:8});return r;},
  });regressionCompleted=true;return result;},
  report:()=>({executionMode:mode,commandAudit:structuredClone(audit),realDeploymentExecuted:audit.some(x=>x.realWrite),realRegressionExecuted:mode==='live'&&(httpAttempted||browserAttempted),regressionPassed:regressionCompleted,
   realDeploymentAttempted:Object.values(outcomes).some(x=>x!=='not-attempted'),workerOutcome:outcomes.worker,pagesOutcome:outcomes.pages,
   httpAttempted,browserAttempted,commandFailure,publicationStopReason,
   workerDryRunExecuted:mode==='keyless'&&audit.some(x=>x.workerDryRunExecuted),httpSimulated:mode==='keyless',browserSimulated:mode==='keyless',
   browserCommandValidated:audit.some(x=>x.phase==='browser'),browserTests:8}),
 };
}
