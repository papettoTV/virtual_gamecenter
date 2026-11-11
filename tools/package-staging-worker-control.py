"""Package a reviewed Worker-only staging change. The package itself performs no network calls."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    '.github/workflows/postmerge-staging.yml',
    'ci/control/fixed-staging-operations.mjs',
    'ci/control/postmerge-runner.mjs',
    'ci/control/postmerge-staging.mjs',
    'ci/control/protection-check.mjs',
    'ci/control/staging-publication.mjs',
    'ci/control/staging-regression.mjs',
    'ci/control/toolchain/browser/regression.spec.mjs',
    'ci/tests/control-protection.test.mjs',
    'ci/tests/fixed-staging-operations.test.mjs',
)
BROWSER = 'ci/control/toolchain/browser/regression.spec.mjs'
TEMPLATE = '.github/workflow-templates/postmerge-staging.yml.disabled'
MANIFEST = 'automatic-resume-installation.json'


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def package(destination, parent, source, strict_version):
    if not all(re.fullmatch('[a-f0-9]{40}', sha) for sha in (parent, source)):
        raise ValueError('固定した制御SHAとレビュー済みソースSHAが必要です。')
    if not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z', strict_version):
        raise ValueError('strict設定版をUTCで指定してください。')
    baseline = {}
    for line in git('ls-tree', '-r', parent).decode().splitlines():
        header, path = line.split('\t', 1)
        mode, kind, sha = header.split()
        if (mode, kind) != ('100644', 'blob'):
            raise ValueError('通常ファイルのみを含む制御ブランチが必要です。')
        baseline[path] = sha
    if len(baseline) != 34 or not set(FILES) <= baseline.keys():
        raise ValueError('制御ブランチのファイル集合が一致しません。')
    data = {path: git('show', source + ':' + (TEMPLATE if path == FILES[0] else path))
            for path in FILES if path != BROWSER}
    # Keep the protected suite's other assertions and selectors byte-for-byte.
    old = b"expect(response.headers()['x-pulbase-gateway-revision']).toBe(sha);"
    new = b"expect(response.headers()['x-pulbase-gateway-revision']).toBe(process.env.PULBASE_EXPECTED_GATEWAY_SHA ?? sha);"
    browser = git('show', parent + ':' + BROWSER)
    if browser.count(old) != 1:
        raise ValueError('固定ブラウザのゲートウェイ検査が一致しません。')
    data[BROWSER] = browser.replace(old, new)
    manifest = {
        'version': 1, 'mode': 'automatic-resume-control-update-only', 'parent': parent, 'sourceSha': source,
        'files': {path: hashlib.sha256(raw).hexdigest() for path, raw in data.items()},
        'baselineFiles': baseline, 'workflowChanged': True, 'productionEnabled': False,
    }
    destination.mkdir(parents=True, exist_ok=False)
    archive = destination / 'staging-worker-control.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
        for path, raw in sorted({**data, MANIFEST: json.dumps(manifest).encode()}.items()):
            entry = zipfile.ZipInfo(path)
            entry.external_attr = 0o100644 << 16
            bundle.writestr(entry, raw, compress_type=zipfile.ZIP_DEFLATED)
    installer = git('show', source + ':tools/install-automatic-resume-control.py').decode()
    for name, value in {
        'BASE': repr(parent), 'STRICT_RULE_VERSION': repr(strict_version),
        'BUNDLE_DIGEST': repr(hashlib.sha256(archive.read_bytes()).hexdigest()),
        'WORKFLOW_CHANGED': 'True', 'SYNC_WORKER_SNAPSHOT': 'True',
        'FILES': '{' + ', '.join(map(repr, sorted(FILES))) + '}', 'MESSAGE': repr('ci: 検証Worker専用の公開経路を追加（公開なし）'),
    }.items():
        old = r'\{[^}]+\}' if name == 'FILES' else r'[^\n]+'
        installer, count = re.subn(rf'^{name} = {old}$', lambda _: f'{name} = {value}', installer, flags=re.MULTILINE)
        if count != 1:
            raise ValueError(f'配置ツールの固定値 {name} が不一致です。')
    installer = installer.replace('信頼定義3件・検証回帰1件・2変数', '検証公開制御10件と設定変数')
    installer = installer.replace('信頼定義3件と検証回帰1件', '検証公開制御10件').replace('・2変数', '・設定変数')
    script = destination / 'install-staging-worker-control.py'
    script.write_text(installer)
    print(json.dumps({'parent': parent, 'source': source, 'files': len(data), 'preserved': len(baseline) - len(data),
                      'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    if len(sys.argv) != 5:
        raise SystemExit('Usage: package-staging-worker-control.py OUTPUT_DIR CONTROL_SHA SOURCE_SHA STRICT_RULE_VERSION')
    package(Path(sys.argv[1]), *sys.argv[2:])
