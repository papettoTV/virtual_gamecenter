import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeText,reviewDiagnostic,unitDiagnostic,reportDiagnostic,boundedDiagnostics,archiveDiagnostic,collectDiagnostics,candidateDiagnostic} from '../repair-diagnostics.mjs';
import {execFileSync} from 'node:child_process';
test('診断から認証値・URL・base64を除去し、長さを制限する',()=>{
 const value=safeText('Bearer ABC password=hidden sk-'+ 'a'.repeat(50)+' https://example.com/private '+ 'X'.repeat(400));
 for(const key of ['ABC','hidden','https://','X'.repeat(180)])assert.ok(!value.includes(key));assert.ok(safeText('a'.repeat(4000)).length<=1000);assert.equal(safeText('x <= 820; () => true'),'x <= 820; () => true');
 assert.ok(Buffer.byteLength(JSON.stringify(boundedDiagnostics(Array(100).fill({kind:'ui',message:'失敗'.repeat(1000)}))))<=10000);
});
test('レビュー指摘と単体FAILを抽出し、成功・壊れたJSONは指摘としない',()=>{
 assert.equal(reviewDiagnostic('REVIEW_RESULT: {"pass":false,"findings":["レイアウト不備"]}')[0].message,'レイアウト不備');
 for(const s of ['REVIEW_RESULT: {"pass":true,"findings":[]}','REVIEW_RESULT: bad'])assert.deepEqual(reviewDiagnostic(s),[]);
 assert.equal(unitDiagnostic('FAIL tests/games/demo.test.ts\nAssertionError: expected visible')[0].kind,'unit');
});
test('失敗caseだけを抽出し、画像添付と成功ケースを引き継がない',()=>{
 const report={suites:[{file:'case.spec.mjs',specs:[{title:'開始',tests:[{projectName:'mobile',results:[{status:'failed',errors:[{message:'isMobile is not defined'}],attachments:[{body:'PRIVATE_IMAGE'}]}]},{projectName:'desktop',results:[{status:'passed'}]}]}]}]};
 const result=reportDiagnostic(report);assert.equal(result.length,1);assert.equal(result[0].project,'mobile');assert.ok(!JSON.stringify(result).includes('PRIVATE_IMAGE'));
 const zip=execFileSync('python3',['-c',`import io,json,zipfile,sys
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:z.writestr('report.json',sys.argv[1])
sys.stdout.buffer.write(b.getvalue())`,JSON.stringify(report)]);
 assert.equal(archiveDiagnostic(zip)[0].message,'isMobile is not defined');
 assert.throws(()=>archiveDiagnostic(Buffer.from('not a zip')));
});

test('失敗ログの読取停止を成功へ読み替えず、診断不足として返す',async()=>{
 const repository='papettoTV/virtual_gamecenter',head='a'.repeat(40);
 const api=async path=>{
  if(path.startsWith('actions/runs?'))return {total_count:2,workflow_runs:[{id:1,path:'.github/workflows/web-checks.yml',head_sha:head,head_repository:{full_name:repository},status:'completed',run_attempt:1,conclusion:'failure'},{id:2,path:'.github/workflows/codex-pr.yml',head_sha:head,head_repository:{full_name:repository},status:'completed',run_attempt:1,conclusion:'failure'}]};
  if(path.includes('/artifacts?'))return {artifacts:[]};
  return {total_count:1,jobs:[{id:3,name:path.includes('/1/')?'unit':'review-gate',conclusion:'failure'}]};
 };
 const result=await collectDiagnostics({api,artifact:async()=>{throw Error('unused');},log:async()=>{throw Error('secret-do-not-print');}},{head:{sha:head}});
 assert.equal(result.failed,true);assert.equal(result.ready,true);assert.equal(result.entries.length,2);
 assert.ok(result.entries.every(x=>x.kind==='diagnostic-unavailable'));
 assert.ok(!JSON.stringify(result).includes('secret-do-not-print'));
});
test('Candidate testsの待機失敗をアプリ診断と区別し、生ログを引き継がない',async()=>{
 const log='Cookie: private\nCI_EVIDENCE_RESULT: {"code":"ci-evidence-timeout","message":"sk-private"}\n';
 const result=candidateDiagnostic(log);assert.equal(result[0].kind,'ci-control');assert.equal(result[0].title,'ci-evidence-timeout');
 assert.ok(!JSON.stringify(result).includes('private'));
 for(const value of ['old generic log','CI_EVIDENCE_RESULT: invalid','CI_EVIDENCE_RESULT: {"code":"attacker"}'])assert.equal(candidateDiagnostic(value)[0].title,'candidate-verification-failed');
 const head='a'.repeat(40),repository='papettoTV/virtual_gamecenter';let reads=0;
 const api=async path=>path.startsWith('actions/runs?')?{total_count:2,workflow_runs:[
  {id:1,path:'.github/workflows/web-checks.yml',conclusion:'success'},
  {id:2,path:'.github/workflows/codex-pr.yml',conclusion:'failure'}].map(r=>({...r,head_sha:head,head_repository:{full_name:repository},status:'completed',run_attempt:1}))}
  :{total_count:1,jobs:[{id:3,name:'Candidate tests',conclusion:'failure'}]};
 const collected=await collectDiagnostics({api,artifact:async()=>assert.fail('不要な成果物は読まない'),log:async id=>{assert.equal(id,3);reads++;return log;}},{head:{sha:head}});
 assert.equal(reads,1);assert.equal(collected.failed,true);assert.equal(collected.entries[0].title,'ci-evidence-timeout');
});
