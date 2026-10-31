// Read-only deployment diagnosis. No GitHub/Cloudflare token or deployment path.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {runFixedBrowser,sanitizeBrowserFailure,runFixedTool} from '../ci/control/fixed-process.mjs';
const origin='https://develop.virtual-gamecenter.pages.dev';
export async function diagnoseStaging(input,{request=fetch,browser=runFixedBrowser}={}){
 const {sha,username,password}=input??{};
 if(!/^[a-f0-9]{40}$/.test(sha??'')||![username,password].every(v=>typeof v==='string'&&v.length>0&&v.length<=4096))throw Error('invalid-input');
 const result={version:1,mode:'staging-browser-diagnostics',sha,deploymentRequested:false,cloudflareApiUsed:false,httpPassed:false,http:null,browserPassed:false,browserFailure:null};
 let response;
 try{
  response=await request(`${origin}/?release-check=${sha}`,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Authorization:`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`}});
  await response.body?.cancel();
  result.http={status:Number.isSafeInteger(response.status)&&response.status>=100&&response.status<=599?response.status:null,workerShaMatches:response.headers.get('x-pulbase-revision')===sha,pagesShaMatches:response.headers.get('x-pulbase-gateway-revision')===sha};
  result.httpPassed=result.http.status===200&&result.http.workerShaMatches&&result.http.pagesShaMatches;
 }catch{return {...result,stage:'http'};}
 if(!result.httpPassed)return {...result,stage:'http'};
 const environment={PATH:process.env.PATH,HOME:process.env.HOME,
  ...(process.env.PLAYWRIGHT_BROWSERS_PATH?{PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH}:{}),
  PULBASE_BROWSER_ENVIRONMENT:'staging',PULBASE_EXPECTED_SHA:sha,PULBASE_CHECK_USERNAME:username,PULBASE_CHECK_PASSWORD:password};
 try{
  const r=await browser({environment});
  result.browserPassed=r?.exitCode===0&&r.listOnly===false&&r.stats?.expected===8&&r.stats.unexpected===0&&r.stats.flaky===0&&r.stats.skipped===0;
 }catch(e){result.browserFailure=sanitizeBrowserFailure(e?.browserFailure);}
 return {...result,stage:'browser'};
}
async function main(){
 const raw=await readFile('/dev/stdin','utf8');
 if(Buffer.byteLength(raw)>16384)throw Error('invalid-input');
 const input=JSON.parse(raw);
 // Keep screenshots and all incidental output inside the caller's disposable dir.
 const directory=process.argv[2];
 if(!directory?.startsWith('/private/tmp/pulbase-staging-browser-diagnostic-'))throw Error('invalid-output');
 const result=await diagnoseStaging(input,{browser:options=>runFixedBrowser({...options,process:async(tool,args,opts)=>{
  if(tool!=='playwright')throw Error('invalid-tool');
  return runFixedTool(tool,[...args,'--output',directory+'/browser-output'],opts);
 }})});
 console.log(JSON.stringify(result,null,2));process.exitCode=result.httpPassed&&result.browserPassed?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.log(JSON.stringify({version:1,mode:'staging-browser-diagnostics',stage:'diagnostic-start',deploymentRequested:false,cloudflareApiUsed:false}));process.exitCode=1;});
