#!/usr/bin/env python3
"""Preparation only. Never called in workflows or as an artifact fallback."""
import hashlib,json,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
FILES=['AGENTS.md','.github/workflows/codex-pr.yml','.github/workflows/web-checks.yml',
 'ci/prompts/review.md','ci/schemas/review.json','ci/review-receipt.mjs','ci/github.mjs','ci/policy.mjs',
 'ci/issue-routing.mjs','ci/ci-evidence.mjs','ci/staging-artifact.mjs','ci/check-workflows.mjs',
 'ci/package.json','ci/package-lock.json','apps/web/package.json','apps/web/package-lock.json',
 'apps/web/scripts/release-config.mjs','apps/web/scripts/release.mjs','apps/web/scripts/build-pages.mjs',
 'apps/web/scripts/pages-targets.mjs','apps/web/src/pages/gateway.mjs','apps/web/wrangler.jsonc',
 'apps/web/pages/wrangler.jsonc','apps/web/config/pages-targets.json','apps/web/vite.config.ts','.github/workflows/codex-issue.yml','ci/prompts/implement.md','ci/automatic-resume.mjs','ci/publish-patch.mjs','ci/ui-tests.mjs','ci/ui-local.config.mjs','ci/ui-fixtures.mjs','ci/image-assets.mjs','ci/publication-result.mjs','ci/schemas/implementation.json','.github/workflows/automatic-repair.yml','ci/automatic-repair.mjs','ci/repair-ticket.mjs','ci/repair-diagnostics.mjs','ci/repair-workspace.mjs']
def build():
 hashes={}
 for name in FILES:
  p=ROOT/name
  if not p.is_file() or p.is_symlink():raise RuntimeError('通常ファイルでない定義')
  b=p.read_bytes();hashes[name]=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 value={'version':1,'policyId':'review-trust-2026-11-07-v9','repository':'papettoTV/virtual_gamecenter',
  'maxEvidenceAgeMs':86400000,'files':hashes,
  'codexAction':'openai/codex-action@bdf19a4a223ec2549a3e2274a0cf61556bc07675','codexVersion':'0.164.0'}
 (ROOT/'ci/control/review-trust.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
 # Keep the keyless production inspection's pins consistent with the exact
 # files installed by the human maintenance bundle. No release flag changes.
 p=ROOT/'ci/production-candidate/policy.json'
 policy=json.loads(p.read_text())
 policy['reviewPolicyDigest']=hashlib.sha256(json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
 baseline_source=(ROOT/'tools/package-automatic-resume-control.py').read_text()
 base=re.search(r"^BASE = '([a-f0-9]{40})'$",baseline_source,re.MULTILINE)
 if not base:raise RuntimeError('人用配置の親SHAが不完全です。')
 rows=subprocess.check_output(['git','ls-tree','-r',base[1]],cwd=ROOT,text=True).splitlines()
 baseline={line.split('\t')[1]:line.split()[2] for line in rows}
 if len(baseline)!=34 or len(policy['controlFiles'])!=28 or not set(policy['controlFiles'])<=baseline.keys():raise RuntimeError('既存の保護制御の固定一覧が不一致です。')
 for name in policy['controlFiles']:policy['controlFiles'][name]=baseline[name]
 for name in ['ci/control/review-trust.mjs','ci/control/review-trust.json','ci/control/toolchain/browser/regression.spec.mjs']:
  target=ROOT/name
  if not target.is_file() or target.is_symlink() or name not in policy['controlFiles']:raise RuntimeError('保護側の候補検査定義が不完全です。')
  raw=target.read_bytes();policy['controlFiles'][name]=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
 p.write_text(json.dumps(policy,ensure_ascii=False,indent=2)+'\n')
 print('固定する信頼定義:',len(hashes),'ファイル（保護ブランチへの配置前は公開認可に使用しない）')
if __name__=='__main__':build()
