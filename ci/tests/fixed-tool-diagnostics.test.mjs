import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeToolDiagnostics,sanitizeCommandFailure} from '../control/fixed-process.mjs';
import {failureReport} from '../control/postmerge-runner.mjs';
test('実行元の秘密値・レスポンス・任意パスを出さず、CFの数値コードと固定分類だけを残す',()=>{
 const r=safeToolDiagnostics('\x1b[31mAuthentication error\x1b[0m /accounts/private-account/workers/services/pulbase-staging failed [code: 10000] token=private-token /arbitrary-private/path',['private-token']);
 assert.deepEqual(r,{category:'authorization',apiCodes:[10000],endpoints:['worker-service']});assert.ok(!JSON.stringify(r).includes('private'));
 const masked=safeToolDiagnostics('[code: 12345]',['12345']);assert.deepEqual(masked.apiCodes,[]);
 const missing=safeToolDiagnostics('The following required secrets have not been set: PRIVATE_SECRET=secret');assert.equal(missing.category,'missing-secret');assert.ok(!JSON.stringify(missing).includes('PRIVATE_SECRET'));
});
test('診断結果の任意フィールド・文字列コードを失敗成果物へ流し込まない',()=>{
 const commandFailure={phase:'worker',exitCode:1,category:'authorization',apiCodes:[10000,'private',-1],endpoints:['worker-service','private'],raw:'private-token'};
 const report=failureReport({phase:'publication',sha:'a'.repeat(40),operationStatus:{workerOutcome:'unknown',commandFailure}});
 assert.deepEqual(report.commandFailure,{phase:'worker',exitCode:1,category:'authorization',apiCodes:[10000],endpoints:['worker-service']});assert.ok(!JSON.stringify(report).includes('private'));assert.equal(report.partialPublicationPossible,true);
 assert.equal(sanitizeCommandFailure(null),null);
});
