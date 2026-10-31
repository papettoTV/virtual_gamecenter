// Fixed local tools, argument arrays, isolated env; never echo child stdout/stderr.
import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('./toolchain/',import.meta.url));
const tools={wrangler:{package:'wrangler',version:'4.114.0',entry:'bin/wrangler.js'},playwright:{package:'@playwright/test',version:'1.61.1',entry:'cli.js'}};
export async function runFixedTool(tool,args,{cwd=root,env={},timeout=180000}={}){
 if(!Object.hasOwn(tools,tool)||!Array.isArray(args)||args.some(a=>typeof a!=='string'))throw Error('固定ツール以外は拒否');
 const spec=tools[tool],packageRoot=resolve(root,'node_modules',spec.package);
 const metadata=JSON.parse(await readFile(resolve(packageRoot,'package.json'),'utf8'));
 const entry=await realpath(resolve(packageRoot,spec.entry));
 if(metadata.name!==spec.package||metadata.version!==spec.version||!entry.startsWith(await realpath(packageRoot)+sep))throw Error('固定ツールの版・パスが不一致');
 const result=spawnSync(process.execPath,[entry,...args],{cwd,env,encoding:'utf8',shell:false,timeout,maxBuffer:8*1024*1024,windowsHide:true});
 const diagnostics=result.error?{category:result.error.code==='ETIMEDOUT'?'timeout':'start-failed',apiCodes:[],endpoints:[]}:safeToolDiagnostics((result.stdout??'')+'\n'+(result.stderr??''),Object.values(env));
 return {exitCode:result.status,stdout:tool==='playwright'?(result.stdout??''):'',diagnostics};
}
// Only fixed categories, numeric CF codes and allowlisted endpoint labels escape.
export function safeToolDiagnostics(raw,secrets=[]){
 let text=String(raw??'').slice(0,8*1024*1024);
 for(const value of secrets)if(typeof value==='string'&&value.length>0)text=text.split(value).join('[redacted]');
 text=text.replace(/\x1b\[[0-9;]*m/g,'');
 // Wrangler may emit a second auth-handler error; keep the original failure distinct.
 const primary=text.includes('[ERROR]')?text.split('[ERROR]')[1]:text;
 const apiCodes=[...new Set([...primary.matchAll(/\[code:\s*([0-9]{3,8})\]/g)].map(x=>Number(x[1])))].slice(0,8);
 const paths={'worker-service':'/workers/services/pulbase-staging','worker-script':'/workers/scripts/pulbase-staging','asset-upload':'/workers/assets/upload','token-verification':'/user/tokens/verify'};
 const endpoints=Object.entries(paths).filter(([,path])=>primary.includes(path)).map(([label])=>label);
 const category=/required secrets have not been set|inherit binding.+invalid/i.test(primary)?'missing-secret':/Authentication error|Unauthorized|Forbidden|permission|\b10000\b/i.test(primary)?'authorization':/Unknown argument|invalid.+config|configuration.+invalid/i.test(primary)?'configuration':/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(primary)?'connection':apiCodes.includes(10021)?'script-validation':'command-failed';
 const hints=Object.entries({'durable-objects':/durable object|migration/i,'d1-binding':/\bD1\b|database/i,'r2-binding':/\bR2\b|bucket/i,'analytics-binding':/analytics engine|analytics_engine/i,'assets':/asset|upload-session/i,'runtime-startup':/Uncaught|TypeError|ReferenceError|startup/i}).filter(([,pattern])=>pattern.test(primary)).map(([name])=>name);
 return {category,apiCodes,endpoints,hints};
}
export function sanitizeCommandFailure(value){
 if(!value)return null;
 const categories=['missing-secret','authorization','configuration','connection','command-failed','timeout','start-failed','script-validation'];
 return {phase:['worker','pages'].includes(value.phase)?value.phase:'unknown',exitCode:Number.isSafeInteger(value.exitCode)?value.exitCode:null,
  category:categories.includes(value.category)?value.category:'command-failed',
  apiCodes:Array.isArray(value.apiCodes)?value.apiCodes.filter(v=>Number.isSafeInteger(v)&&v>=100&&v<=99999999).slice(0,8):[],
  endpoints:Array.isArray(value.endpoints)?value.endpoints.filter(v=>['worker-service','worker-script','asset-upload','token-verification'].includes(v)).slice(0,4):[],
  hints:Array.isArray(value.hints)?value.hints.filter(v=>['durable-objects','d1-binding','r2-binding','analytics-binding','assets','runtime-startup'].includes(v)).slice(0,6):[]};
}
export function publicToolEnvironment(){return {PATH:process.env.PATH,CI:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'};}
function countTests(suites){return (suites??[]).reduce((n,s)=>n+(s.specs??[]).reduce((m,p)=>m+(p.tests?.length??0),0)+countTests(s.suites),0);}
export function parseBrowserReport(raw,{listOnly=false}={}){
 let report;try{report=JSON.parse(raw);}catch{throw Error('ブラウザ結果JSONが不正です。元出力は保存しません');}
 const count=countTests(report.suites);
 if(count!==8||!Array.isArray(report.errors)||report.errors.length)throw Error('固定ブラウザ8件の結果が不完全');
 if(listOnly)return {listOnly:true,listedTests:count};
 const s=report.stats;
 if(s?.expected!==8||s.unexpected!==0||s.flaky!==0||s.skipped!==0)throw Error('ブラウザ回帰に失敗・skipがあります');
 return {listOnly:false,stats:{expected:8,unexpected:0,flaky:0,skipped:0}};
}
// Never retain Playwright config, error text, attachments, URLs or arbitrary titles.
const browserCases=new Map([
 ['home renders active games and versioned Worker/Pages','home'],
 ['legal navigation /legal/terms','terms'],
 ['legal navigation /legal/privacy','privacy'],
 ['game navigation allows declining credit and returning before play','game-navigation'],
]);
const browserStatuses=['passed','failed','timedOut','skipped','interrupted'];
const browserCategories=['timeout','assertion','locator','browser-start','other'];
function boundedInteger(v,max){return Number.isSafeInteger(v)&&v>=0&&v<=max?v:null;}
function browserError(error){
 const text=String(error?.message??'').slice(0,65536),stack=String(error?.stack??'').slice(0,65536);
 const category=/timeout|timed out/i.test(text)?'timeout':/strict mode violation|resolved to .*elements/i.test(text)?'locator':/expect\(|Expected:|Received:/i.test(text)?'assertion':/browserType\.launch|executable doesn't exist|browser closed/i.test(text)?'browser-start':'other';
 const file=String(error?.location?.file??'');
 const match=stack.match(/(?:^|\/)regression\.spec\.mjs:(\d{1,4}):\d{1,4}(?:\D|$)/);
 const line=file.endsWith('/regression.spec.mjs')?boundedInteger(error.location.line,9999):match?Number(match[1]):null;
 return {category,line};
}
export function browserDiagnostics(raw,exitCode){
 const fallback={version:1,kind:'invalid-report',exitCode:boundedInteger(exitCode,255),cases:[],errors:[]};
 if(typeof raw!=='string'||Buffer.byteLength(raw)>8*1024*1024)return fallback;
 let report;try{report=JSON.parse(raw);}catch{return {...fallback,kind:'process-failure'};}
 const cases=[],seen=new Set();let invalid=false;
 function visit(suites,depth=0){
  if(!Array.isArray(suites)||depth>12||suites.length>32){invalid=true;return;}
  for(const suite of suites){
   if(!suite||!Array.isArray(suite.specs??[])||(suite.specs??[]).length>8){invalid=true;return;}
   for(const spec of suite.specs??[]){
    const id=browserCases.get(spec?.title);
    if(!id||!Array.isArray(spec.tests)||spec.tests.length>2){invalid=true;return;}
    for(const test of spec.tests){
     const project=test?.projectName,key=`${project}/${id}`;
     if(!['desktop','mobile'].includes(project)||seen.has(key)||!Array.isArray(test.results)||test.results.length!==1){invalid=true;return;}
     seen.add(key);const result=test.results[0];
     if(!browserStatuses.includes(result?.status)||!Array.isArray(result.errors??[])||(result.errors??[]).length>16){invalid=true;return;}
     cases.push({case:id,project,status:result.status,durationMs:boundedInteger(result.duration,240000),errors:(result.errors??[]).slice(0,4).map(browserError)});
    }
   }
   if(suite.suites)visit(suite.suites,depth+1);
  }
 }
 visit(report?.suites);
 if(invalid||cases.length>8||!Array.isArray(report?.errors)||report.errors.length>16)return fallback;
 // An interrupted launch may produce fewer than eight results; keep it incomplete.
 return {version:1,kind:cases.length===8?'test-results':'incomplete-report',exitCode:boundedInteger(exitCode,255),cases,errors:report.errors.slice(0,4).map(browserError)};
}
export function sanitizeBrowserFailure(value){
 if(!value||value.version!==1)return null;
 const kind=['invalid-report','process-failure','incomplete-report','test-results'].includes(value.kind)?value.kind:'invalid-report';
 const errors=items=>Array.isArray(items)?items.slice(0,4).map(e=>({category:browserCategories.includes(e?.category)?e.category:'other',line:boundedInteger(e?.line,9999)})):[];
 const cases=Array.isArray(value.cases)?value.cases.slice(0,8).filter(c=>[...browserCases.values()].includes(c?.case)&&['desktop','mobile'].includes(c?.project)&&browserStatuses.includes(c?.status)).map(c=>({case:c.case,project:c.project,status:c.status,durationMs:boundedInteger(c.durationMs,240000),errors:errors(c.errors)})):[];
 return {version:1,kind,exitCode:boundedInteger(value.exitCode,255),cases,errors:errors(value.errors)};
}
export async function runFixedBrowser({environment,listOnly=false,process=runFixedTool}){
 const config=resolve(root,'staging-browser.config.mjs');
 const args=['test','--config',config,'--reporter=json',...(listOnly?['--list']:[])];
 const r=await process('playwright',args,{cwd:root,env:environment,timeout:240000});
 try{
  if(r.exitCode!==0)throw Error();
  return {exitCode:0,...parseBrowserReport(r.stdout,{listOnly})};
 }catch{
  const error=Error('ブラウザ起動または回帰が不合格です。元出力は保存しません');
  error.browserFailure=browserDiagnostics(r.stdout,r.exitCode);throw error;
 }
}
