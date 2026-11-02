import {execFileSync} from 'node:child_process';
import {readFile,mkdir,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {auditPaths,auditProductionSettings} from '../production-settings-audit.mjs';
import {productionCandidate} from './evidence.mjs';
const repository='papettoTV/virtual_gamecenter';
export function readJsonArchive(bytes,name){
 try{return JSON.parse(execFileSync('python3',['-I','-B',fileURLToPath(new URL('../../tools/read-production-evidence.py',import.meta.url)),name],
  {input:bytes,encoding:'utf8',env:{PATH:process.env.PATH},maxBuffer:2*1024*1024,timeout:15000,stdio:['pipe','pipe','pipe']}));
 }catch{throw Error('証跡ZIPを拒否しました。内容は表示していません。');}
}
export function candidateReader(run=(args)=>execFileSync('gh',args,{maxBuffer:1024*1024,timeout:20000,stdio:['pipe','pipe','pipe']})){
 const allowed=path=>auditPaths.includes(path)||/^(?:git\/ref\/heads\/(?:develop|ci-control|main)|git\/commits\/[a-f0-9]{40}|git\/trees\/[a-f0-9]{40}\?recursive=1|compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40}|actions\/runs\/[1-9][0-9]*(?:\/(?:jobs\?filter=latest&per_page=100|artifacts\?per_page=100))?|actions\/workflows\/web-checks\.yml\/runs\?head_sha=[a-f0-9]{40}&event=push&per_page=100|actions\/workflows\/production-preparation\.yml\/runs\?head_sha=[a-f0-9]{40}&per_page=100)$/.test(path);
 const get=path=>{
  try{return run(['api','--method','GET',`repos/${repository}/${path}`]);}
  catch{throw Error('証跡を読み取れません。API応答・認証値は表示していません。');}
 };
 return {
  api:async path=>{if(!allowed(path))throw Error('対象外APIを拒否しました。');try{return JSON.parse(get(path).toString('utf8'));}catch{throw Error('許可された証跡APIの読取に失敗しました。');}},
  load:async artifactId=>{if(!/^[1-9][0-9]*$/.test(artifactId))throw Error('成果物IDが不正です。');return get(`actions/artifacts/${artifactId}/zip`);},
 };
}
async function main(){
 if(process.argv.length!==4||!process.argv.slice(2).every(x=>/^[1-9][0-9]*$/.test(x)))throw Error('検証公開run IDと本番準備run IDの2つだけを指定してください。');
 const directory=fileURLToPath(new URL('../results/',import.meta.url)),output=`${directory}production-candidate.json`;
 await mkdir(directory,{recursive:true});await rm(output,{force:true});
 const read=candidateReader();
 await auditProductionSettings(read.api);
 const policy=JSON.parse(await readFile(new URL('./policy.json',import.meta.url),'utf8'));
 const reviewPolicy=JSON.parse(await readFile(new URL('../control/review-trust.json',import.meta.url),'utf8'));
 const result=await productionCandidate({...read,parse:readJsonArchive,policy,reviewPolicy,stagingRunId:process.argv[2],preparationRunId:process.argv[3]});
 await auditProductionSettings(read.api);
 await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
