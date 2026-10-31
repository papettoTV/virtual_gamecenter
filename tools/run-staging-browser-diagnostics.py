#!/usr/bin/env python3
"""Human terminal only. Input Basic credentials privately, retain only safe JSON."""
import getpass
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_FILES = None  # Set by packaging reviewed, committed diagnostic code.
EXPECTED_SHA = '0655696a661d2344edc3d0570b9037bc605b643d'
NODE = '/opt/homebrew/opt/node@22/bin/node'
BROWSERS = '/private/tmp/pulbase-ui-harness-probe/browsers'


def main():
    if not EXPECTED_FILES or any(hashlib.sha256((ROOT / p).read_bytes()).hexdigest() != digest for p, digest in EXPECTED_FILES.items()):
        raise RuntimeError('レビュー済みの診断コードと一致しません。認証は入力せず停止します。')
    version = subprocess.check_output([NODE, '--version'], text=True, timeout=5).strip()
    if not version.startswith('v22.'):
        raise RuntimeError('固定Node.jsが見つかりません。')
    print('検証URLのSHA照合と固定ブラウザ8件だけを実行します。公開・鍵の保存は行いません。')
    username = getpass.getpass('Staging Basic username（入力は非表示）: ')
    password = getpass.getpass('Staging Basic password（入力は非表示）: ')
    if not username or not password:
        raise RuntimeError('検証Basic認証が未入力です。')
    folder = Path(tempfile.mkdtemp(prefix='pulbase-staging-browser-diagnostic-', dir='/private/tmp'))
    env = {k: os.environ[k] for k in ('HOME', 'USER', 'LOGNAME', 'LANG') if k in os.environ}
    env.update(PATH='/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin', PLAYWRIGHT_BROWSERS_PATH=BROWSERS)
    try:
        child = subprocess.run([NODE, str(ROOT / 'tools/staging-browser-diagnostics.mjs'), str(folder)],
                               input=json.dumps(dict(sha=EXPECTED_SHA, username=username, password=password)),
                               capture_output=True, text=True, env=env, cwd=ROOT, timeout=280)
        # Never echo stdout/stderr on parsing or startup failure: those may hold config.
        result = json.loads(child.stdout)
        if result.get('mode') != 'staging-browser-diagnostics' or result.get('version') != 1:
            raise RuntimeError('診断結果の形式が不正です。元出力は保存しません。')
        target = folder / 'result.json'
        target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print('診断が終了しました。結果: ' + str(target))
        print('成功: ' + str(result.get('httpPassed') is True and result.get('browserPassed') is True))
    finally:
        shutil.rmtree(folder / 'browser-output', ignore_errors=True)


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt):
        print('診断を停止しました。秘密情報・元出力は表示・保存しません。')
        raise SystemExit(1)
