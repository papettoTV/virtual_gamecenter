"""Build a deterministic, additive, keyless installation bundle from committed HEAD."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('installer', ROOT / 'tools/install-production-inspection.py')
INSTALL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALL)


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def package(directory):
    directory.mkdir(parents=True, exist_ok=True)
    source = git('rev-parse', 'HEAD').decode().strip()
    data = {path: git('show', source + ':' + path) for path in sorted(INSTALL.FILES)}
    policy = json.loads(data['ci/production-candidate/policy.json'])
    baseline = {line.split('\t')[1]: line.split()[2] for line in git('ls-tree', '-r', INSTALL.BASE).decode().splitlines()}
    if policy.get('controlFiles') != baseline or policy.get('controlSha') != INSTALL.BASE:
        raise RuntimeError('配置元の固定制御一覧が不一致です。')
    for path, expected in policy['preparationFiles'].items():
        if INSTALL.blob(git('show', source + ':' + path)) != expected:
            raise RuntimeError('配置元の本番準備定義が不一致です。')
    manifest = {'version': 1, 'mode': 'production-inspection-install-only', 'parent': INSTALL.BASE, 'sourceSha': source,
                'workflowChanged': False, 'productionEnabled': False, 'baselineFiles': baseline,
                'files': {path: hashlib.sha256(raw).hexdigest() for path, raw in data.items()}}
    data[INSTALL.MANIFEST] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    archive_path = directory / 'production-inspection.zip'
    with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path, raw in sorted(data.items()):
            info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    bundle_hash = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    template = git('show', source + ':tools/install-production-inspection.py').decode()
    script = template.replace("BUNDLE_DIGEST = 'PACKAGED_BUNDLE_DIGEST'", 'BUNDLE_DIGEST = ' + repr(bundle_hash))
    if script == template:
        raise RuntimeError('配置ツールのdigestを固定できません。')
    script_path = directory / 'install-production-inspection.py'
    script_path.write_text(script)
    # Validate the packaged installer against the actual ZIP, without a key or network.
    spec = importlib.util.spec_from_file_location('packaged_installer', script_path)
    packaged = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(packaged)
    checked, checked_baseline = packaged.bundle(archive_path)
    if checked != data or checked_baseline != baseline or packaged.APPLY_RULE_VERSION is not None:
        raise RuntimeError('単独配置ツールの検査に失敗しました。')
    with tempfile.TemporaryDirectory(prefix='pulbase-inspection-package-') as scratch:
        root = Path(scratch)
        for path in baseline:
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(git('show', INSTALL.BASE + ':' + path))
        for path, raw in data.items():
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        # These test-only source files never enter the installation ZIP.
        test_sources = set(policy['preparationFiles']) | {'ci/tests/production-candidate.test.mjs', 'ci/tests/production-settings-audit.test.mjs'}
        for path in test_sources:
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(git('show', source + ':' + path))
        subprocess.run(['node', '--test', 'ci/tests/production-candidate.test.mjs', 'ci/tests/production-settings-audit.test.mjs'], cwd=root, check=True, timeout=60)
    report = {'mode': 'package-only', 'sourceSha': source, 'parent': INSTALL.BASE, 'bundleSha256': bundle_hash,
              'installerSha256': hashlib.sha256(script_path.read_bytes()).hexdigest(), 'addedFiles': len(data),
              'existingFilesPreserved': len(baseline), 'isolatedTestsPassed': True,
              'applyEnabled': False, 'privateKeyUsed': False, 'writeRequested': False, 'deploymentRequested': False}
    (directory / 'package-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('出力先ディレクトリだけを指定してください。')
    package(Path(sys.argv[1]).expanduser().absolute())
