"""Build a review-only control update. No credentials, network, or Git writes."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile
import importlib.util
import re

ROOT = Path(__file__).resolve().parents[1]
BASE = 'ddc92cdf2193a68674a1c8ec2451c7ca71990ff4'
FILES = ('ci/control/review-trust.mjs', 'ci/control/review-trust.json',
         'ci/production-candidate/policy.json', 'ci/control/toolchain/browser/regression.spec.mjs')


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
    if all(blobs[path] == baseline[path] for path in FILES):
        raise RuntimeError('信頼定義の差分がありません。')
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
    return plan, data


def package_installer(destination, plan, data, rule_version):
    if not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z', rule_version):
        raise RuntimeError('一時例外のUTC設定版が不正です。')
    manifest = {'version': 1, 'mode': 'automatic-resume-control-update-only',
                'parent': BASE, 'sourceSha': plan['sourceSha'],
                'files': plan['files'], 'baselineFiles': plan['baselineFiles'],
                'workflowChanged': False, 'productionEnabled': False}
    files = data | {'automatic-resume-installation.json': (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()}
    archive_path = destination / 'automatic-resume-control.zip'
    with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path, raw in sorted(files.items()):
            info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    bundle_digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    template = git('show', plan['sourceSha'] + ':tools/install-automatic-resume-control.py').decode()
    script = template.replace("BUNDLE_DIGEST = 'PACKAGED_BUNDLE_DIGEST'", 'BUNDLE_DIGEST = ' + repr(bundle_digest))
    script = script.replace('APPLY_RULE_VERSION = None ', 'APPLY_RULE_VERSION = ' + repr(rule_version) + ' ')
    if script == template or 'PACKAGED_BUNDLE_DIGEST' in script or 'APPLY_RULE_VERSION = None ' in script:
        raise RuntimeError('配置用の固定値を設定できません。')
    script_path = destination / 'install-automatic-resume-control.py'
    script_path.write_text(script)
    spec = importlib.util.spec_from_file_location('packaged_resume_installer', script_path)
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    checked, baseline = installer.bundle(archive_path)
    if checked != data or baseline != plan['baselineFiles'] or installer.APPLY_RULE_VERSION != rule_version:
        raise RuntimeError('生成した単独配置ツールの検査が不一致です。')
    print(json.dumps({'mode': 'installer-packaged-not-executed', 'sourceSha': plan['sourceSha'],
                      'ruleVersion': rule_version, 'targetFiles': len(checked),
                      'changedFiles': sum(blobs != baseline[path] for path, blobs in plan['replacementBlobs'].items()),
                      'preservedFiles': len(baseline) - sum(blobs != baseline[path] for path, blobs in plan['replacementBlobs'].items()),
                      'archiveSha256': bundle_digest,
                      'installerSha256': hashlib.sha256(script_path.read_bytes()).hexdigest(),
                      'writeRequested': False}, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) not in (2, 3):
        raise SystemExit('Usage: python3 tools/package-automatic-resume-control.py OUTPUT_DIRECTORY [REVIEWED_RULE_VERSION_UTC]')
    destination = Path(sys.argv[1])
    plan, data = package(destination)
    if len(sys.argv) == 3:
        package_installer(destination, plan, data, sys.argv[2])
