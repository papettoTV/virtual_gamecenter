"""Package a pinned human-only diagnostic entry point, without credentials/network."""
import hashlib
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FILES = ('tools/staging-browser-diagnostics.mjs', 'ci/control/fixed-process.mjs',
         'ci/control/toolchain/staging-browser.config.mjs',
         'ci/control/toolchain/browser/regression.spec.mjs')


def package(destination):
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    hashes = {}
    for path in FILES:
        raw = subprocess.check_output(['git', 'show', source + ':' + path], cwd=ROOT)
        if (ROOT / path).read_bytes() != raw:
            raise RuntimeError('未コミットの診断コードは梱包しません。')
        hashes[path] = hashlib.sha256(raw).hexdigest()
    template = subprocess.check_output(['git', 'show', source + ':tools/run-staging-browser-diagnostics.py'], cwd=ROOT, text=True)
    template = template.replace('ROOT = Path(__file__).resolve().parents[1]', 'ROOT = Path(' + repr(str(ROOT)) + ')')
    template = template.replace('EXPECTED_FILES = None ', 'EXPECTED_FILES = ' + repr(hashes) + ' ')
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / 'run-staging-browser-diagnostics.py'
    target.write_text(template)
    print('sourceSha=' + source)
    print('script=' + str(target))
    print('sha256=' + hashlib.sha256(target.read_bytes()).hexdigest())


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 tools/package-staging-browser-diagnostics.py OUTPUT_DIRECTORY')
    package(Path(sys.argv[1]))
