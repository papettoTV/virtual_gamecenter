// Read-only diagnostics. Never execute artifacts or forward candidate logs verbatim.
import {execFileSync} from 'node:child_process';
export function safeText(value, limit=1000){
 return String(value??'').replace(/\x1b\[[0-9;]*m/g,'').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'')
 .replace(/(?:Bearer|Basic)\s+[^\s"']+/gi,'[認証値除去]').replace(/\b(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]+/g,'[鍵除去]')
 .replace(/(?:password|secret|token|authorization)\s*[:=]\s*[^\s,;]+/gi,'[認証項目除去]')
 .replace(/https?:\/\/[^\s)"<>]+/g,'[URL除去]').replace(/[A-Za-z0-9+/=_-]{180,}/g,'[長いデータ除去]')
 .replaceAll('-->','--＞').slice(0,limit);
}
export function reviewDiagnostic(log){
 const line=String(log).split('\n').find(x=>x.includes('REVIEW_RESULT:')&&x.length<32000);
 if(!line)return [];
 let value;try{value=JSON.parse(line.slice(line.indexOf('REVIEW_RESULT:')+14).trim());}catch{return [];}
 if(value?.pass!==false||!Array.isArray(value.findings))return [];
 return value.findings.slice(0,8).filter(x=>typeof x==='string').map(x=>({kind:'review',message:safeText(x,1500)}));
}
export function unitDiagnostic(log){
 const lines=String(log).replace(/\x1b\[[0-9;]*m/g,'').split('\n');const out=[];
 for(let i=0;i<lines.length&&out.length<12;i++)if(/\bFAIL\s+tests\/|AssertionError:|Error:.*(?:expected|tests\/)/.test(lines[i])){
  out.push({kind:'unit',message:safeText(lines.slice(i,i+7).filter(x=>x.length<3000).join('\n'),1200)});
 }
 return out;
}
export function reportDiagnostic(report){
 const out=[];const visit=suites=>{for(const suite of suites??[]){
  for(const spec of suite.specs??[])for(const test of spec.tests??[])for(const result of test.results??[]){
   if(['failed','timedOut','interrupted'].includes(result.status)&&out.length<24)out.push({kind:'ui',file:safeText(spec.file??suite.file,180),project:safeText(test.projectName,30),title:safeText(spec.title,180),message:safeText((result.errors??[result.error]).filter(Boolean).map(x=>x.message??x.value??'').join('\n'),1200)});
  }visit(suite.suites);
 }};visit(report?.suites);
 for(const e of (report?.errors??[]).slice(0,3))out.push({kind:'ui-runner',message:safeText(e.message)});
 return out;
}
// ZIPs are data only: the helper never extracts members or runs their contents.
const zipSummary=`import io,json,sys,zipfile
raw=sys.stdin.buffer.read(262144001)
if len(raw)>262144000:raise ValueError('archive size')
with zipfile.ZipFile(io.BytesIO(raw)) as z:
 entries=z.infolist()
 if len(entries)>4000 or sum(x.file_size for x in entries)>536870912:raise ValueError('archive limits')
 names=[x for x in entries if x.filename=='report.json']
 if len(names)!=1 or names[0].file_size>209715200:raise ValueError('report size')
 r=json.loads(z.read(names[0]))
 def visit(suites):
  for s in suites:
   for p in s.get('specs',[]):
    for t in p.get('tests',[]):
     for q in t.get('results',[]):
      if q.get('status') in ['failed','timedOut','interrupted']:
       yield {'file':str(p.get('file',s.get('file','')))[:180],'title':str(p.get('title',''))[:180],'project':str(t.get('projectName',''))[:30],'errors':[str(e.get('message',e.get('value','')))[:1200] for e in q.get('errors',[])[:2]]}
   yield from visit(s.get('suites',[]))
 import itertools
 print(json.dumps({'failures':list(itertools.islice(visit(r.get('suites',[])),24)),'errors':[str(x.get('message',''))[:1200] for x in r.get('errors',[])[:3]]}))`;
export function archiveDiagnostic(bytes){
 const value=JSON.parse(execFileSync('python3',['-c',zipSummary],{input:bytes,maxBuffer:100000,stdio:['pipe','pipe','pipe']}));
 return [...value.failures.map(x=>({kind:'ui',file:safeText(x.file,180),title:safeText(x.title,180),project:safeText(x.project,30),message:safeText(x.errors.join('\n'),1200)})),...value.errors.map(x=>({kind:'ui-runner',message:safeText(x)}))];
}
export function boundedDiagnostics(entries){
 const out=[],seen=new Map();for(const x of [...entries].sort((a,b)=>(['unit','review'].includes(b.kind)?1:0)-(['unit','review'].includes(a.kind)?1:0))){const item={};for(const [k,v]of Object.entries(x))if(['kind','file','title','project','message'].includes(k))item[k]=safeText(v,k==='message'?1500:200);
  const signature=JSON.stringify([item.kind,item.file,item.message?.slice(0,256)]);
  if(seen.has(signature)){const previous=out[seen.get(signature)];if(item.project&&!previous.project?.includes(item.project))previous.project=safeText([previous.project,item.project].filter(Boolean).join(' / '),30);continue;}
  if(Buffer.byteLength(JSON.stringify([...out,item]))>9500)continue;seen.set(signature,out.length);out.push(item);
 }while(Buffer.byteLength(JSON.stringify(out))>10000)out.pop();return out;
}
export async function collectDiagnostics({api,artifact,log},pr){
 const runs=await api(`actions/runs?head_sha=${pr.head.sha}&event=pull_request&per_page=100`);
 if(!Array.isArray(runs.workflow_runs)||runs.total_count>=100)throw Error('診断対象run一覧が不完全です');
 const entries=[];let failed=false;
 for(const path of ['.github/workflows/web-checks.yml','.github/workflows/codex-pr.yml']){
  const run=runs.workflow_runs.filter(r=>r.path===path&&r.head_sha===pr.head.sha&&r.head_repository?.full_name==='papettoTV/virtual_gamecenter').sort((a,b)=>b.id-a.id)[0];
  if(!run||run.status!=='completed')return {ready:false,reason:run?'checks-in-progress':'missing-ci',entries:[]};
  if(run.run_attempt!==1)throw Error('再実行runを修正診断へ流用しません');
  if(run.conclusion!=='failure')continue;failed=true;
  const jobs=await api(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
  if(jobs.total_count!==jobs.jobs?.length||jobs.total_count>=100)throw Error('診断対象job一覧が不完全です');
  if(path.endsWith('web-checks.yml')){
   const artifacts=await api(`actions/runs/${run.id}/artifacts?per_page=100`);
   const evidence=artifacts.artifacts.filter(a=>a.name.startsWith('ui-evidence-')&&!a.expired&&a.workflow_run?.id===run.id&&a.workflow_run.head_sha===pr.head.sha);
   if(evidence.length===1&&evidence[0].size_in_bytes<=250*1024*1024)try{entries.push(...archiveDiagnostic(await artifact(evidence[0].id)));}catch{entries.push({kind:'diagnostic-unavailable',message:'UI証跡を容量制限内で読み取れません。テスト条件は緩和しないでください。'});}
   const unit=jobs.jobs.find(j=>j.name==='unit'&&j.conclusion==='failure');if(unit)try{entries.push(...unitDiagnostic(await log(unit.id)));}catch{entries.push({kind:'diagnostic-unavailable',message:'通常テストの失敗ログを取得できません。CI成功として扱わないでください。'});}
  }else{
   const gate=jobs.jobs.find(j=>j.name==='review-gate'&&j.conclusion==='failure');if(gate)try{entries.push(...reviewDiagnostic(await log(gate.id)));}catch{entries.push({kind:'diagnostic-unavailable',message:'レビュー不合格のログを取得できません。レビュー成功として扱わないでください。'});}
  }
 }
 return {ready:true,failed,entries:boundedDiagnostics(entries)};
}
