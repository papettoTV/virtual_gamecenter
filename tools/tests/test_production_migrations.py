import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('migrations', Path(__file__).resolve().parents[1] / 'check-production-migrations.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class MigrationTests(unittest.TestCase):
    def test_actual_migrations_rehearse_without_remote_or_disk_database(self):
        result = M.rehearse(Path(__file__).resolve().parents[2] / 'apps/web/migrations')
        self.assertTrue(result['passed'])
        expected = sorted(p.name for p in (Path(__file__).resolve().parents[2] / 'apps/web/migrations').glob('*.sql'))
        self.assertEqual(result['migrationCount'], len(expected))
        self.assertEqual([f['file'] for f in result['files']], expected)
        self.assertFalse(result['remoteMigrationApplied'])
        self.assertFalse(result['remoteDatabaseAccessed'])
        self.assertTrue(all(len(f['sha256']) == 64 for f in result['files']))

    def test_external_database_file_and_extension_operations_are_rejected(self):
        for sql in ["ATTACH DATABASE 'external.db' AS other", 'DETACH DATABASE other', "SELECT load_extension('file')", "VACUUM INTO 'external.db'"]:
            with tempfile.TemporaryDirectory() as tmp:
                Path(tmp, '0001.sql').write_text(sql)
                with self.assertRaises(RuntimeError):
                    M.rehearse(tmp)

    def test_invalid_sql_and_symlink_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(RuntimeError):
                M.rehearse(tmp)
            sql = Path(tmp, '0001.sql')
            sql.write_text('THIS IS NOT SQL')
            with self.assertRaises(Exception):
                M.rehearse(tmp)
            sql.unlink()
            sql.symlink_to('/etc/passwd')
            with self.assertRaises(RuntimeError):
                M.rehearse(tmp)


if __name__ == '__main__':
    unittest.main()
