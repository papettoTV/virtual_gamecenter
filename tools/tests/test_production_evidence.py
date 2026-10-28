import importlib.util
import io
import pathlib
import unittest
import zipfile

path = pathlib.Path(__file__).resolve().parents[1] / "read-production-evidence.py"
spec = importlib.util.spec_from_file_location("production_evidence", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def archive(entries):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as output:
        for name, value in entries:
            output.writestr(name, value)
    return data.getvalue()


class EvidenceTests(unittest.TestCase):
    def test_single_json_without_extraction(self):
        data = archive([("postmerge-result.json", '{"status":"passed"}')])
        self.assertEqual(module.read_evidence(data, "postmerge-result.json"), {"status": "passed"})

    def test_reject_path_extra_member_oversize_and_bad_json(self):
        for entries in [
            [("../postmerge-result.json", "{}")],
            [("postmerge-result.json", "{}"), ("script.sh", "exit 0")],
            [("postmerge-result.json", "x" * (module.LIMIT + 1))],
            [("postmerge-result.json", "not JSON")],
        ]:
            with self.subTest(entries=entries[0][0]), self.assertRaises(Exception):
                module.read_evidence(archive(entries), "postmerge-result.json")

    def test_reject_symbolic_link(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as output:
            entry = zipfile.ZipInfo("postmerge-result.json")
            entry.create_system = 3
            entry.external_attr = 0o120777 << 16
            output.writestr(entry, "{}")
        with self.assertRaises(ValueError):
            module.read_evidence(data.getvalue(), "postmerge-result.json")


if __name__ == "__main__":
    unittest.main()
