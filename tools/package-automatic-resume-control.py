"""Build a review-only control update. No credentials, network, or Git writes."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASE = '7dd7b4cab720d6f268cd406932475f1cce5dcc3d'
FILES = ('ci/control/review-trust.mjs', 'ci/control/review-trust.json',
         'ci/production-candidate/policy.json')


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def package(destination):
    source = git('rev-parse', 'HEAD').decode().strip()
    baseline = {line.split('\t')[1]: line.split()[2]
                for line in git('ls-tree', '-r', BASE).decode().splitlines()}
    if len(baseline) != 34 or not set(FILES) <= baseline.keys():
        raise RuntimeError('保護ブランチの固定一覧が一致しません。')
    data = {path: git('show', source + ':' + path) for path in FILES}
    blobs = {path: hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
             for path, raw in data.items()}
    if any(blobs[path] == baseline[path] for path in FILES):
        raise RuntimeError('更新対象3件の差分を確認できません。')
    plan = {'mode': 'review-only', 'parent': BASE, 'sourceSha': source,
            'baselineFiles': baseline, 'replacementBlobs': blobs,
            'workflowChanged': False, 'deploymentRequested': False,
            'refWriteRequested': False, 'bypassChangeRequested': False,
            'files': {path: hashlib.sha256(raw).hexdigest() for path, raw in data.items()}}
    destination.mkdir(parents=True, exist_ok=True)
    archive_path = destination / 'automatic-resume-control-review.zip'
    with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path, raw in sorted(data.items()):
            info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    plan['archiveSha256'] = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    (destination / 'automatic-resume-control-plan.json').write_text(
        json.dumps(plan, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in plan.items() if k not in ('baselineFiles', 'files')}, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 tools/package-automatic-resume-control.py OUTPUT_DIRECTORY')
    package(Path(sys.argv[1]))
