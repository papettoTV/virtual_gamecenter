import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {frozenIntent,checkPacket,simulateApproved} from '../control/approved-candidate.mjs';
const execution={repository:'papettoTV/virtual_gamecenter',ref:'refs/heads/ci-control',event:'workflow_dispatch',runId:'101',attempt:'1',controlSha:'a'.repeat(40),environment:'staging'};
const receipt={repository:execution.repository,pullNumber:'40',head:'b'.repeat(40),base:'c'.repeat(40),candidate:'d'.repeat(40),tree:'e'.repeat(40),buildRun:'20',buildAttempt:'1',buildArtifact:'30',pass:true};
const hash=v=>createHash('sha256').update(v).digest('hex');
function packet(){const manifestDigest='f'.repeat(64);return {version:1,mode:'protected-real-evidence-rehearsal',execution:structuredClone(execution),reviewRun:'10',protection:{preflightReady:true,execution:structuredClone(execution)},receipt:structuredClone(receipt),receiptDigest:hash(JSON.stringify(receipt)),manifestDigest,intent:frozenIntent(receipt,manifestDigest)};}
test('同一run・制御SHA・候補・成果物ハッシュに承認対象を固定',()=>{assert.equal(checkPacket(packet(),execution,'10').candidate,receipt.candidate);});
test('別run・別制御SHA・再実行・候補や成果物の差替えを拒否',()=>{
 for(const change of [{runId:'102'},{controlSha:'9'.repeat(40)},{attempt:'2'},{ref:'refs/heads/develop'}])assert.throws(()=>checkPacket(packet(),{...execution,...change},'10'));
 for(const mutate of [p=>p.receipt.head='9'.repeat(40),p=>p.manifestDigest='8'.repeat(64),p=>p.intent.base='9'.repeat(40),p=>p.reviewRun='11']){const p=packet();mutate(p);assert.throws(()=>checkPacket(p,execution,'10'));}
});
test('実候補は2回再取得し、副作用は模擬に限定して承認1回の状態遷移を通す',async()=>{
 let reads=0;const r=await simulateApproved({intent:packet().intent,execution,observe:async()=>{reads++;}});
 assert.equal(reads,2);assert.equal(r.rehearsalPassed,true);assert.equal(r.intendedApprovalCount,1);assert.equal(r.realMergeExecuted,false);assert.equal(r.realDeploymentExecuted,false);assert.equal(r.mergedCiSimulated,true);
});
test('承認後の実証跡失効・マージ直前の候補変更は模擬処理も停止',async()=>{
 for(const stopAt of [1,2]){let reads=0;await assert.rejects(simulateApproved({intent:packet().intent,execution,observe:async()=>{if(++reads===stopAt)throw Error('候補変更');}}),e=>e.mergeOutcome==='not-attempted');}
});
