#!/usr/bin/env python3
"""Public-code package, based on the independently verified existing control tree."""
import hashlib,json,stat,subprocess,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PREVIOUS='90cfba234ec84aee19f0e19e3827a9939a5de6a3'
OUTPUT=Path('/private/tmp/pulbase-trusted-runtime-preparation.zip')
UPDATES={p:p for p in ['ci/control/candidate-evidence.mjs','ci/control/approved-candidate.mjs','ci/control/single-approval.mjs',
 'ci/tests/approved-candidate.test.mjs','ci/tests/single-approval.test.mjs','ci/control/review-trust.mjs','ci/control/review-trust.json',
 'ci/control/staging-publication.mjs','ci/control/staging-regression.mjs','ci/control/staging-merge.mjs','ci/control/staging-target.json',
 'ci/control/staging-gateway.mjs','ci/control/toolchain/package.json','ci/control/toolchain/package-lock.json',
 'ci/control/toolchain/staging-browser.config.mjs','ci/control/toolchain/browser/regression.spec.mjs',
 'ci/tests/review-trust.test.mjs','ci/tests/staging-runtime.test.mjs','docs/staging-runtime-preparation.md']}
UPDATES['README.md']='docs/staging-runtime-preparation.md'
def build():
 paths=subprocess.check_output(['git','ls-tree','-r','--name-only',PREVIOUS],cwd=ROOT,text=True).splitlines()
 entries={p:subprocess.check_output(['git','show',PREVIOUS+':'+p],cwd=ROOT) for p in paths if p!='bundle-manifest.json'}
 for dst,src in UPDATES.items():
  p=ROOT/src
  if p.is_symlink() or not stat.S_ISREG(p.lstat().st_mode):raise RuntimeError('通常ファイルのみ')
  entries[dst]=p.read_bytes()
 for name,b in entries.items():
  if len(b)>1024*1024 or b'-----BEGIN PRIVATE KEY-----' in b or b'-----BEGIN RSA PRIVATE KEY-----' in b or '..' in name.split('/'):raise RuntimeError('不正な配布ファイル')
 manifest={'version':3,'mode':'trust-and-runtime-preparation','repository':'papettoTV/virtual_gamecenter','branch':'ci-control',
  'previousControlSha':PREVIOUS,'deploymentEnabled':False,'liveTransportConnected':False,
  'reviewPolicyFileSha256':hashlib.sha256(entries['ci/control/review-trust.json']).hexdigest(),
  'files':{n:hashlib.sha256(b).hexdigest() for n,b in sorted(entries.items())}}
 entries['bundle-manifest.json']=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode()
 with zipfile.ZipFile(OUTPUT,'w') as z:
  for n,b in sorted(entries.items()):
   info=zipfile.ZipInfo(n,(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=(stat.S_IFREG|0o644)<<16;z.writestr(info,b)
 value=hashlib.sha256(OUTPUT.read_bytes()).hexdigest();OUTPUT.with_suffix('.sha256').write_text(value+'  '+OUTPUT.name+'\n')
 print(json.dumps({'path':str(OUTPUT),'files':len(entries),'sha256':value,'deploymentRequested':False,'liveTransportConnected':False}))
 return value,set(entries)-{'bundle-manifest.json'}
if __name__=='__main__':build()
