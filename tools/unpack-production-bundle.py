"""Extract a bounded bundle into a fresh directory without following links."""
import shutil
import stat
import sys
import zipfile
from pathlib import Path

TOTAL_LIMIT = 250 * 1024 * 1024 + 4 * 1024 * 1024
MEMBER_LIMIT = 100 * 1024 * 1024


def unpack(source, target):
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if not 0 < len(entries) <= 20001 or sum(entry.file_size for entry in entries) > TOTAL_LIMIT:
            raise ValueError("bundle size")
        seen = set()
        for entry in entries:
            name = entry.orig_filename
            parts = name.split("/")
            mode = stat.S_IFMT(entry.external_attr >> 16)
            if (entry.filename != name or name in seen or len(name) > 1024
                    or any(part in ("", ".", "..") for part in parts)
                    or any(ord(char) < 32 or char in "\\:" for char in name)
                    or mode not in (0, stat.S_IFREG) or entry.flag_bits & 1
                    or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                    or entry.file_size > MEMBER_LIMIT):
                raise ValueError("bundle member")
            seen.add(name)
        for entry in entries:
            path = target.joinpath(*entry.filename.split("/"))
            path.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as content, path.open("xb") as output:
                shutil.copyfileobj(content, output)


if __name__ == "__main__":
    try:
        source, target = map(Path, sys.argv[1:])
        target.mkdir(mode=0o700)
        unpack(source, target)
    except Exception:
        print("本番成果物ZIPを拒否しました。内容は表示していません。", file=sys.stderr)
        sys.exit(1)
