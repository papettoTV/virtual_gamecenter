#!/usr/bin/env python3
"""Explicit staging live control package. Packaging does not deploy or contain keys."""
from pathlib import Path
import hashlib,json,stat,zipfile
ROOT=Path(__file__).resolve().parents[1]
PREVIOUS='f17a56415d6e8bd59b36d5106a7b2a39bd99ecbd'
OUTPUT=Path('/private/tmp/pulbase-staging-diagnostics.zip')
FILES={p:p for p in ['ci/tests/fixed-tool-diagnostics.test.mjs','ci/control/fixed-process.mjs','ci/control/fixed-staging-operations.mjs','ci/tests/fixed-staging-operations.test.mjs','ci/control/postmerge-staging.mjs','ci/control/postmerge-runner.mjs','ci/control/protection-check.mjs',
 'ci/control/candidate-evidence.mjs','ci/control/review-trust.mjs','ci/control/review-trust.json','ci/control/premerge-decision.mjs','ci/control/develop-merge.mjs',
 'ci/control/staging-publication.mjs','ci/control/staging-regression.mjs','ci/control/staging-target.json','ci/control/staging-gateway.mjs',
 'ci/control/toolchain/package.json','ci/control/toolchain/package-lock.json','ci/control/toolchain/staging-browser.config.mjs','ci/control/toolchain/browser/regression.spec.mjs',
 'ci/tests/control-protection.test.mjs','ci/tests/postmerge-staging.test.mjs','ci/tests/review-trust.test.mjs','ci/tests/staging-runtime.test.mjs']}
FILES['.github/workflows/postmerge-staging.yml']='.github/workflow-templates/postmerge-staging.yml.disabled'
FILES['README.md']='docs/staging-live-release.md'
def build():
 entries={}
 for dst,src in FILES.items():
  p=ROOT/src
  if p.is_symlink() or not stat.S_ISREG(p.lstat().st_mode):raise RuntimeError('通常ファイルのみ')
  b=p.read_bytes()
  if len(b)>1024*1024 or b'-----BEGIN PRIVATE KEY-----' in b or b'-----BEGIN RSA PRIVATE KEY-----' in b:raise RuntimeError('不正な配布ファイル')
  entries[dst]=b
 manifest={'version':7,'mode':'postmerge-staging-live','repository':'papettoTV/virtual_gamecenter','branch':'ci-control','previousControlSha':PREVIOUS,
  'deploymentEnabled':True,'liveTransportConnected':True,'mergeEnabled':False,'regressionCount':1,
  'files':{n:hashlib.sha256(b).hexdigest() for n,b in sorted(entries.items())}}
 entries['bundle-manifest.json']=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode()
 with zipfile.ZipFile(OUTPUT,'w') as z:
  for n,b in sorted(entries.items()):
   info=zipfile.ZipInfo(n,(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=(stat.S_IFREG|0o644)<<16;z.writestr(info,b)
 value=hashlib.sha256(OUTPUT.read_bytes()).hexdigest();OUTPUT.with_suffix('.sha256').write_text(value+'  '+OUTPUT.name+'\n')
 print(json.dumps({'archive':str(OUTPUT),'sha256':value,'files':len(entries),'realDeploymentRequested':False,'realMergeRequested':False}))
 return value,set(FILES)
if __name__=='__main__':build()
