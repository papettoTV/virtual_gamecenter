// Protected keyless bridge: real evidence, one staging approval, simulated side effects.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { executionContext, readApi, verifyProtection } from './protection-check.mjs';
import { approvalScope, runApprovedTransaction } from './single-approval.mjs';
import { apiRead, receiptArtifact, liveEvidence, checkBuild } from './candidate-evidence.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
function need(value, text) { if (!value) throw Error(text); }
export function frozenIntent(receipt, manifestDigest) {
  need(/^[a-f0-9]{64}$/.test(manifestDigest), '成果物の固定ハッシュなし');
  return { repository: receipt.repository, baseRef: 'develop', pullNumber: String(receipt.pullNumber),
    head: receipt.head, base: receipt.base, candidate: receipt.candidate, tree: receipt.tree, parents: [receipt.base,receipt.head],
    review: { pass: receipt.pass, head: receipt.head, base: receipt.base, candidate: receipt.candidate },
    build: { sha: receipt.candidate, tree: receipt.tree, event: 'pull_request', checkSha: receipt.head,
      runId: String(receipt.buildRun), attempt: receipt.buildAttempt, artifactId: String(receipt.buildArtifact),
      artifactDigest: manifestDigest, ciPassed: true, artifactVerified: true } };
}
export function checkPacket(packet, execution, expectedRun) {
  need(packet?.version === 1 && packet.mode === 'protected-real-evidence-rehearsal'
    && JSON.stringify(packet.execution) === JSON.stringify(execution) && packet.reviewRun === String(expectedRun)
    && packet.protection?.preflightReady === true
    && JSON.stringify(packet.protection.execution) === JSON.stringify(execution)
    && /^[a-f0-9]{64}$/.test(packet.manifestDigest ?? '')
    && packet.receiptDigest === digest(JSON.stringify(packet.receipt)), '別実行・別候補の承認対象を拒否');
  const intent = frozenIntent(packet.receipt,packet.manifestDigest);
  need(JSON.stringify(intent) === JSON.stringify(packet.intent), '承認前の固定対象が不一致');
  approvalScope(intent,execution); // Validate structure; this is not the human approval.
  return intent;
}
export async function simulateApproved({ intent, execution, observe, now = Date.now }) {
  const scope = approvalScope(intent,execution,now());
  const phases=[];
  const syntheticSha=createHash('sha1').update(`SIMULATED ONLY:${execution.runId}:${intent.candidate}`).digest('hex');
  const merged={repository:intent.repository,baseRef:'develop',pullNumber:intent.pullNumber,head:intent.head,
    merged:true,method:'squash',sha:syntheticSha,tree:intent.tree,develop:syntheticSha,parents:[intent.base]};
  const simulated=(label,value)=>async()=>{phases.push(label);return structuredClone(value);};
  const result=await runApprovedTransaction({scope,execution,now,adapters:{
    observeCandidate:async()=>{await observe();phases.push('実PR・候補・CI・レビューの再照合');return {
      repository:intent.repository,baseRef:'develop',pullNumber:intent.pullNumber,state:'open',draft:false,
      head:intent.head,base:intent.base,develop:intent.base,candidate:intent.candidate,tree:intent.tree };},
    publishCandidate:simulated('候補公開の模擬'),regressCandidate:simulated('候補回帰の模擬',{passed:true,sha:intent.candidate,tree:intent.tree}),
    merge:simulated('マージの模擬（GitHub書込なし）',merged),
    waitForMergedCi:simulated('実マージCIの模擬（実際のpush CIではない）',{...intent.build,event:'push',sha:syntheticSha,checkSha:syntheticSha}),
    observeMerged:simulated('模擬マージ対象の照合',merged),publishMerged:simulated('実SHA再公開の模擬'),
    regressMerged:simulated('最終回帰の模擬',{passed:true,sha:syntheticSha,tree:intent.tree}) }});
  return {mode:'protected-real-evidence-rehearsal',runId:execution.runId,controlSha:execution.controlSha,
    pullNumber:intent.pullNumber,head:intent.head,base:intent.base,candidate:intent.candidate,tree:intent.tree,
    realEvidenceVerified:true,intendedApprovalCount:1,rehearsalPassed:result.status==='completed',phases,
    mergedCiSimulated:true,realMergeExecuted:false,realDeploymentExecuted:false,productionRequested:false};
}
async function output(values) { await appendFile(process.env.GITHUB_OUTPUT,Object.entries(values).map(([k,v])=>`${k}=${v}\n`).join('')); }
async function json(path) { const raw=await readFile(path,'utf8');need(Buffer.byteLength(raw)<65536,'承認対象ファイル過大');return JSON.parse(raw); }
async function main() {
  const execution=executionContext(),api=apiRead(process.env.GH_TOKEN),mode=process.argv[2],run=process.env.REVIEW_RUN_ID;
  if(mode==='locate') {
    const protection=await verifyProtection(readApi(process.env.GH_TOKEN),execution,{requireSnapshot:false});
    await writeFile('control-protection.json',JSON.stringify(protection));
    const artifact=await receiptArtifact(api,run);await output({receipt_id:artifact.id});return;
  }
  if(mode==='identify') {const receipt=await json('receipt/review-receipt.json');const target=await liveEvidence(api,receipt,run);await output({artifact_id:target.artifactId,build_run:target.buildRun});return;}
  if(mode==='freeze') {
    const receipt=await json('receipt/review-receipt.json');await liveEvidence(api,receipt,run);
    const files=await checkBuild('candidate-build',receipt),manifestDigest=digest(await readFile('candidate-build/manifest.json'));
    const protection=await json('control-protection.json');
    const packet={version:1,mode:'protected-real-evidence-rehearsal',execution,reviewRun:String(run),protection,
      receipt,receiptDigest:digest(JSON.stringify(receipt)),manifestDigest,intent:frozenIntent(receipt,manifestDigest),files};
    checkPacket(packet,execution,run);await liveEvidence(api,receipt,run);
    await writeFile('candidate-approval.json',JSON.stringify(packet,null,2));
    if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## 実証跡の承認対象（公開なし）\nPR: #${receipt.pullNumber}\nHead: ${receipt.head}\nBase: ${receipt.base}\n候補: ${receipt.candidate}\n制御SHA: ${execution.controlSha}\n\n承認後は同じ候補を再照合して模擬処理だけを実行します。マージ・公開は行いません。\n`);return;
  }
  need(['approved-input','approved'].includes(mode),'不明なモード');
  const packet=await json('candidate-approval.json'),intent=checkPacket(packet,execution,run);
  await verifyProtection(readApi(process.env.GH_TOKEN),execution,{ruleVersions:process.env.PULBASE_CONTROL_RULE_VERSIONS});
  const target=await liveEvidence(api,packet.receipt,run);
  if(mode==='approved-input') {await output({artifact_id:target.artifactId,build_run:target.buildRun});return;}
  const files=await checkBuild('candidate-build',packet.receipt);
  need(digest(await readFile('candidate-build/manifest.json'))===packet.manifestDigest && files===packet.files,'承認前後の成果物不一致');
  const report=await simulateApproved({intent,execution,observe:()=>liveEvidence(api,packet.receipt,run)});
  await liveEvidence(api,packet.receipt,run);
  await writeFile('approved-candidate-result.json',JSON.stringify({...report,filesVerified:files,protectionVerified:true},null,2));
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'## 保護された実証跡の予行試験が成功\n実PR/CI/レビューを再照合しました。公開・回帰・マージ・マージ後CIは模擬です。実際のマージ・公開はありません。\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
