import {createHash} from 'node:crypto';
const repo='papettoTV/virtual_gamecenter', repoUrl=`https://api.github.com/repos/${repo}`;
const sha=v=>/^[a-f0-9]{40}$/.test(v??'');
const required=['AGENTS.md','.github/workflows/codex-pr.yml','.github/workflows/web-checks.yml','ci/prompts/review.md','ci/schemas/review.json','ci/review-receipt.mjs','ci/github.mjs','ci/policy.mjs','ci/issue-routing.mjs','ci/ci-evidence.mjs','ci/staging-artifact.mjs','ci/check-workflows.mjs','ci/package.json','ci/package-lock.json','apps/web/package.json','apps/web/package-lock.json','apps/web/scripts/release-config.mjs','apps/web/scripts/release.mjs','apps/web/scripts/build-pages.mjs','apps/web/scripts/pages-targets.mjs','apps/web/src/pages/gateway.mjs','apps/web/wrangler.jsonc','apps/web/pages/wrangler.jsonc','apps/web/config/pages-targets.json','apps/web/vite.config.ts','.github/workflows/codex-issue.yml','ci/prompts/implement.md','ci/automatic-resume.mjs','ci/publish-patch.mjs','ci/ui-tests.mjs','ci/ui-local.config.mjs','ci/ui-fixtures.mjs','ci/image-assets.mjs','ci/publication-result.mjs','ci/schemas/implementation.json'];
function need(v,m){if(!v)throw Error(m);}
export function trustPolicy(value){
 need(value?.version===1&&value.repository===repo&&value.policyId==='review-trust-2026-11-02-v4'
  &&value.maxEvidenceAgeMs===86400000&&value.codexVersion==='0.164.0'
  &&value.codexAction==='openai/codex-action@bdf19a4a223ec2549a3e2274a0cf61556bc07675'
  &&JSON.stringify(Object.keys(value.files??{}).sort())===JSON.stringify([...required].sort())
  &&Object.values(value.files).every(sha),'保護側の信頼定義が不完全です');
 return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export async function verifyReviewTrust(api,receipt,policy,now=Date.now()){
 const policyDigest=trustPolicy(policy);
 need(['head','base','candidate'].every(k=>sha(receipt?.[k]))&&['reviewRun','buildRun','pullNumber'].every(k=>/^[1-9][0-9]*$/.test(String(receipt?.[k]??''))),'証跡の識別子不正');
 for(const [id,path] of [[receipt.reviewRun,'.github/workflows/codex-pr.yml'],[receipt.buildRun,'.github/workflows/web-checks.yml']]){
  const run=await api(`actions/runs/${id}`),pr=run.pull_requests?.[0],at=Date.parse(run.created_at);
  need(String(run.id)===String(id)&&run.path===path&&run.head_sha===receipt.head&&run.event==='pull_request'
   &&run.head_repository?.full_name===repo&&run.status==='completed'&&run.conclusion==='success'&&run.run_attempt===1
   &&Number.isFinite(at)&&at<=now+30000&&now-at<=policy.maxEvidenceAgeMs
   &&run.pull_requests?.length===1&&String(pr.number)===String(receipt.pullNumber)
   &&pr.base?.ref==='develop'&&pr.base.sha===receipt.base&&pr.head?.sha===receipt.head
   &&pr.base.repo?.url===repoUrl&&pr.head.repo?.url===repoUrl,'実行時のPR・定義元・初回・鮮度を証明できません');
 }
 for(const revision of [receipt.base,receipt.head,receipt.candidate]){
  const tree=await api(`git/trees/${revision}?recursive=1`);
  need(tree.truncated===false&&Array.isArray(tree.tree)&&tree.tree.length<20000,'信頼定義のtree取得が不完全です');
  for(const [path,expected] of Object.entries(policy.files)){
   const items=tree.tree.filter(x=>x.path===path);
   need(items.length===1&&items[0].type==='blob'&&items[0].mode==='100644'&&items[0].sha===expected,'レビュー/CI定義が固定版と不一致です: '+path);
  }
  // A new project config can silently change agent behavior even if the workflow matches.
  need(!tree.tree.some(x=>/^(?:\.codex|\.agents)\//.test(x.path)),'追加のエージェント設定を検出しました。人による定義更新が必要です');
 }
 return {reviewTrustVerified:true,policyId:policy.policyId,policyDigest,reviewRun:String(receipt.reviewRun),buildRun:String(receipt.buildRun)};
}
