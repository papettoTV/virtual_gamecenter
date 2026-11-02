#!/usr/bin/env python3
"""Rehearse tracked migration SQL in an in-memory SQLite database only."""
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import sys


def rehearse(directory):
    paths = sorted(Path(directory).glob('*.sql'))
    if not paths or any(p.is_symlink() or not p.is_file() for p in paths):
        raise RuntimeError('通常の移行SQLが必要です')
    result = []
    with sqlite3.connect(':memory:') as database:
        for path in paths:
            raw = path.read_bytes()
            sql = raw.decode('utf-8')
            if re.search(r'\b(?:ATTACH|DETACH|load_extension)\b|\bVACUUM\s+INTO\b', sql, re.I):
                raise RuntimeError('外部DB・ファイルへの接続は禁止です')
            database.executescript(sql)
            result.append({'file': path.name, 'sha256': hashlib.sha256(raw).hexdigest()})
        if database.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or database.execute('PRAGMA foreign_key_check').fetchall():
            raise RuntimeError('ローカル移行の整合性検査が不合格です')
        tables = database.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0]
    return {'mode': 'sqlite-memory-only', 'passed': True, 'migrationCount': len(result), 'tableCount': tables,
            'files': result, 'remoteDatabaseAccessed': False, 'remoteMigrationApplied': False}


if __name__ == '__main__':
    if len(sys.argv) != 1:
        raise SystemExit('対象DBやコマンドの指定は受け付けません')
    try:
        print(json.dumps(rehearse(Path(__file__).resolve().parents[1] / 'apps/web/migrations'), ensure_ascii=False))
    except Exception:
        raise SystemExit('メモリ内の移行リハーサルに失敗しました。外部DBは操作していません。')
