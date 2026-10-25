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
 if(result.error)throw Error('固定ツールが時間切れまたは起動失敗しました。詳細出力は保存しません');
 return {exitCode:result.status,stdout:result.stdout??''};
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
export async function runFixedBrowser({environment,listOnly=false,process=runFixedTool}){
 const config=resolve(root,'staging-browser.config.mjs');
 const args=['test','--config',config,'--reporter=json',...(listOnly?['--list']:[])];
 const r=await process('playwright',args,{cwd:root,env:environment,timeout:240000});
 if(r.exitCode!==0)throw Error('ブラウザ起動または回帰が不合格です。元出力は保存しません');
 return {exitCode:0,...parseBrowserReport(r.stdout,{listOnly})};
}
