import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {prepareStagingPublication,publicationCommands,preservePagesBuildMetadata,samePagesConfiguration} from '../ci/control/staging-publication.mjs';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const scratch=await mkdtemp(join(tmpdir(),'pages-metadata-check-'));
const artifact=join(scratch,'artifact');await mkdir(join(artifact,'worker'),{recursive:true});await mkdir(join(artifact,'client'));
const sha='a'.repeat(40),tree='b'.repeat(40),files={};
const gateway=(await readFile(join(root,'ci/control/staging-gateway.mjs'),'utf8')).replace('__PULBASE_GATEWAY_REVISION__',sha);
for(const [path,body] of [['worker/index.js',`export default {}; // ${sha}`],['client/_worker.js',gateway],['client/index.html','local fixture']]){await writeFile(join(artifact,path),body);files[path]=createHash('sha256').update(body).digest('hex');}
await writeFile(join(artifact,'manifest.json'),JSON.stringify({version:1,environment:'staging',sha,tree,runId:'1',attempt:'1',files}));
async function check(preserve){
const plan=await prepareStagingPublication(artifact,{candidate:sha,tree,buildRun:'1',buildAttempt:'1'});
const project={id:'local-only',name:'virtual-gamecenter',production_branch:'main',build_config:{destination_dir:'dist/client',build_command:'npm run build',root_dir:'apps/web'},deployment_configs:{preview:{compatibility_date:'2026-07-26',compatibility_flags:[],env_vars:{APP_ENV:{type:'plain_text',value:'staging'}},services:{BACKEND:{service:'pulbase-staging'}}}}};
const before=structuredClone(project);if(preserve)await preservePagesBuildMetadata(plan,project);
const paths=[];let sentOutputDirectory=null,manifestEntryCount=0;
const jwt=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'dummy-signature'].join('.');
const deployment={id:'11111111-1111-4111-8111-111111111111',url:'https://local-only.pages.dev',environment:'preview',latest_stage:{name:'deploy',status:'success'},stages:[],aliases:['https://develop.virtual-gamecenter.pages.dev']};
const server=http.createServer(async(req,res)=>{
 paths.push({method:req.method,path:req.url});const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks).toString('utf8');
 let result=null,status=200;
 if(req.method==='GET'&&req.url.endsWith('/pages/projects/virtual-gamecenter'))result=project;
 else if(req.url.endsWith('/upload-token'))result={jwt};
 else if(req.url.includes('/pages/assets/check-missing'))result=[];
 else if(req.url.includes('/pages/assets/upsert-hashes'))result=null;
 else if(req.method==='POST'&&req.url.endsWith('/deployments')){
  const manifest=body.match(/name="manifest"\r\n\r\n([^\r\n]*)/)?.[1];manifestEntryCount=manifest?Object.keys(JSON.parse(manifest)).length:0;
  sentOutputDirectory=body.match(/name="pages_build_output_dir"\r\n\r\n([^\r\n]*)/)?.[1]??null;
  if(sentOutputDirectory!==null)project.build_config.destination_dir=sentOutputDirectory;
  result=deployment;
 }else if(req.url.includes('/deployments/'))result=deployment;
 else {status=400;result={};}
 res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({success:status===200,result,errors:status===200?[]:[{code:99999,message:'local fixture does not implement endpoint'}]}));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const r=await promisify(execFile)(process.execPath,[join(root,'ci/control/toolchain/node_modules/wrangler/bin/wrangler.js'),...publicationCommands(plan).pages],{cwd:plan.prepared,env:{PATH:process.env.PATH,CI:'true',CLOUDFLARE_ACCOUNT_ID:plan.account,CLOUDFLARE_API_TOKEN:'dummy-local-only',CLOUDFLARE_API_BASE_URL:`http://127.0.0.1:${server.address().port}/client/v4`,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'},timeout:60000,maxBuffer:4*1024*1024});
 assert.equal(project.build_config.destination_dir==='dist/client',preserve);assert.equal(samePagesConfiguration(before,project),preserve);assert.ok(manifestEntryCount>0);
 console.log(JSON.stringify({mode:'local-only',preserve,exitCode:0,destinationPreserved:project.build_config.destination_dir==='dist/client',manifestEntryCount,requests:paths.length,realCloudflareRequests:0}));
}catch{throw Error('ローカル偽APIでPagesメタデータの検証に失敗しました。CLI出力は表示しません');}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(plan.prepared,{recursive:true,force:true});}
}
try{await check(false);await check(true);}finally{await rm(scratch,{recursive:true,force:true});}
