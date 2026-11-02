"""Read one bounded JSON member from stdin ZIP. Never extract or execute files."""
import io
import json
import stat
import sys
import zipfile

ALLOWED = {"postmerge-approval.json", "postmerge-result.json", "production-preparation.json"}
LIMIT = 1024 * 1024


def read_evidence(data, name):
    if name not in ALLOWED or not data or len(data) > LIMIT:
        raise ValueError("invalid archive")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) != 1:
            raise ValueError("unexpected members")
        entry = entries[0]
        mode = entry.external_attr >> 16
        if (entry.filename != name or entry.is_dir() or entry.flag_bits & 1
                or stat.S_ISLNK(mode) or entry.file_size > LIMIT
                or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
            raise ValueError("invalid member")
        raw = archive.read(entry)
        return json.loads(raw.decode("utf-8"))


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("invalid arguments")
        result = read_evidence(sys.stdin.buffer.read(LIMIT + 1), sys.argv[1])
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        print("証跡ZIPを拒否しました。内容は表示していません。", file=sys.stderr)
        sys.exit(1)
