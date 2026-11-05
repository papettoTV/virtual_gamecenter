import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeText,reviewDiagnostic,unitDiagnostic,reportDiagnostic,boundedDiagnostics,archiveDiagnostic} from '../repair-diagnostics.mjs';
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
