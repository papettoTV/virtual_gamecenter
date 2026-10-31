#!/usr/bin/env python3
"""Preparation only. Never called in workflows or as an artifact fallback."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
FILES=['AGENTS.md','.github/workflows/codex-pr.yml','.github/workflows/web-checks.yml',
 'ci/prompts/review.md','ci/schemas/review.json','ci/review-receipt.mjs','ci/github.mjs','ci/policy.mjs',
 'ci/issue-routing.mjs','ci/ci-evidence.mjs','ci/staging-artifact.mjs','ci/check-workflows.mjs',
 'ci/package.json','ci/package-lock.json','apps/web/package.json','apps/web/package-lock.json',
 'apps/web/scripts/release-config.mjs','apps/web/scripts/release.mjs','apps/web/scripts/build-pages.mjs',
 'apps/web/scripts/pages-targets.mjs','apps/web/src/pages/gateway.mjs','apps/web/wrangler.jsonc',
 'apps/web/pages/wrangler.jsonc','apps/web/config/pages-targets.json','apps/web/vite.config.ts','.github/workflows/codex-issue.yml','ci/prompts/implement.md','ci/automatic-resume.mjs','ci/publish-patch.mjs','ci/ui-tests.mjs','ci/ui-local.config.mjs','ci/ui-fixtures.mjs']
def build():
 hashes={}
 for name in FILES:
  p=ROOT/name
  if not p.is_file() or p.is_symlink():raise RuntimeError('通常ファイルでない定義')
  b=p.read_bytes();hashes[name]=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 value={'version':1,'policyId':'review-trust-2026-10-31-v2','repository':'papettoTV/virtual_gamecenter',
  'maxEvidenceAgeMs':86400000,'files':hashes,
  'codexAction':'openai/codex-action@bdf19a4a223ec2549a3e2274a0cf61556bc07675','codexVersion':'0.164.0'}
 (ROOT/'ci/control/review-trust.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
 print('固定する信頼定義:',len(hashes),'ファイル（保護ブランチへの配置前は公開認可に使用しない）')
if __name__=='__main__':build()
