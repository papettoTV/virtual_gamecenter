import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import hashlib
import io
import tempfile
import zipfile

path = Path(__file__).resolve().parents[1] / 'install-automatic-resume-control.py'
spec = importlib.util.spec_from_file_location('installer', path)
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)


class Fixture:
    def __init__(self):
        self.baseline = {'old/' + str(i): 'a' * 40 for i in range(34 - len(M.FILES))} | {p: 'e' * 40 for p in M.FILES}
        self.data = {p: b'content' for p in M.FILES}
        self.ref = M.BASE
        self.calls = []
        self.mutate = lambda *args: None
        self.fail = None
        self.rule = {'target': 'branch', 'enforcement': 'active', 'updated_at': '2026-10-29T00:00:00.000Z',
                     'bypass_actors': [{'actor_id': M.APP, 'actor_type': 'Integration', 'bypass_mode': 'always'}],
                     'conditions': {'ref_name': {'include': ['refs/heads/ci-control'], 'exclude': []}},
                     'rules': [{'type': t} for t in ('creation', 'update', 'deletion', 'non_fast_forward')]}

    def tree(self, expected):
        return {'truncated': False, 'tree': [{'path': p, 'sha': h, 'mode': '100644', 'type': 'blob'} for p, h in expected.items()]}

    def api(self, method, path, auth=None, body=None):
        assert M.permitted(method, path, body), (method, path)
        self.calls.append((method, path, body))
        self.mutate(method, path, body)
        if self.fail == (method, path):
            return 403, None
        if method == 'DELETE':
            return 204, None
        if path.endswith('/rulesets/25676153'):
            return 200, self.rule
        if path.endswith('/rulesets/25520943'):
            return 200, {'target': 'branch', 'enforcement': 'active', 'updated_at': M.MAIN_RULE_VERSION, 'bypass_actors': [],
                         'conditions': {'ref_name': {'include': ['refs/heads/main'], 'exclude': []}}, 'rules': [{'type': 'update'}]}
        if path.endswith('/git/ref/heads/main'):
            return 200, {'object': {'sha': M.MAIN}}
        if path.endswith('/git/ref/heads/ci-control'):
            return 200, {'object': {'sha': self.ref}}
        if '/git/trees/' in path:
            return 200, self.tree(self.baseline if M.BASE in path else self.baseline | {p: M.blob(b) for p, b in self.data.items()})
        if path.endswith('/environments/staging'):
            return 200, {'can_admins_bypass': False, 'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True},
                         'protection_rules': [{'type': 'required_reviewers', 'reviewers': [{'type': 'User', 'reviewer': {'login': 'papettoTV'}}]}]}
        if 'deployment-branch-policies' in path:
            return 200, {'total_count': 1, 'branch_policies': [{'name': 'ci-control', 'type': 'branch'}]}
        if path == '/app':
            return 200, {'id': M.APP, 'slug': 'pulbase-release', 'owner': {'login': 'papettoTV'}}
        if path.endswith('/installation'):
            return 200, {'app_id': M.APP, 'id': 123, 'suspended_at': None}
        if path.endswith('/access_tokens'):
            return 201, {'token': 'fake-never-print', 'permissions': {'contents': 'write', 'metadata': 'read'}}
        if path == '/installation/repositories':
            return 200, {'total_count': 1, 'repositories': [{'full_name': 'papettoTV/virtual_gamecenter'}]}
        if method == 'GET' and '/git/commits/' in path:
            return 200, {'tree': {'sha': 'b' * 40}}
        if method == 'POST' and path.endswith('/git/trees'):
            return 201, {'sha': 'c' * 40}
        if method == 'POST' and path.endswith('/git/commits'):
            return 201, {'sha': 'd' * 40, 'tree': {'sha': 'c' * 40}, 'parents': [{'sha': M.BASE}]}
        if method == 'PATCH':
            self.ref = body['sha']
            return 200, {'ref': 'refs/heads/ci-control', 'object': {'sha': self.ref}}
        raise AssertionError(path)


class ConfigurationFixture(Fixture):
    def __init__(self):
        super().__init__()
        self.ref = 'd' * 40
        self.rule.update(updated_at='2026-11-04T00:00:00.000Z', bypass_actors=[])
        self.variables = {
            M.REPOSITORY_VARIABLE: {'name': 'PULBASE_CONTROL_EVIDENCE_SHA', 'value': M.BASE},
            M.STAGING_VARIABLE: {'name': 'PULBASE_CONTROL_RULE_VERSIONS', 'value': json.dumps({
                'ciControl': M.STRICT_RULE_VERSION, 'main': M.MAIN_RULE_VERSION, 'protectionMode': 'strict'})}}
        self.lose_response = False

    def api(self, method, path, auth=None, body=None):
        assert M.configuration_permitted(method, path, body), (method, path)
        if path in self.variables:
            self.calls.append((method, path, body))
            self.mutate(method, path, body)
            if self.fail == (method, path):
                return 403, None
            if method == 'GET':
                return 200, dict(self.variables[path])
            self.variables[path] = dict(body)
            if self.lose_response:
                raise RuntimeError('NEVER_PRINT_TOKEN')
            return 204, None
        if method == 'GET' and '/git/commits/' in path:
            self.calls.append((method, path, body))
            return 200, {'tree': {'sha': 'c' * 40}, 'parents': [{'sha': M.BASE}]}
        return super().api(method, path, auth, body)


class ConfigurationTests(unittest.TestCase):
    def configure(self, f):
        return M.configure(f.ref, f.data, f.baseline, 'fake-never-print', f.api)

    def test_exact_two_variables_updated_and_reread_only_after_strict(self):
        f = ConfigurationFixture()
        result = self.configure(f)
        self.assertTrue(result['success'], result)
        self.assertEqual(set(result['updatedVariables']), {'PULBASE_CONTROL_EVIDENCE_SHA', 'PULBASE_CONTROL_RULE_VERSIONS'})
        self.assertEqual([(m, p) for m, p, b in f.calls if m != 'GET'], [
            ('PATCH', M.REPOSITORY_VARIABLE), ('PATCH', M.STAGING_VARIABLE)])
        self.assertNotIn('fake-never-print', json.dumps(result))
        self.assertEqual(f.variables[M.REPOSITORY_VARIABLE]['value'], f.ref)
        self.assertEqual(json.loads(f.variables[M.STAGING_VARIABLE]['value'])['ciControl'], f.rule['updated_at'])
        self.assertFalse(result['credentialSaved'])
        self.assertFalse(result['deploymentRequested'])
        f.calls.clear()
        self.assertTrue(self.configure(f)['success'])
        self.assertFalse(any(m != 'GET' for m, p, b in f.calls))

    def test_bypass_present_or_hidden_stops_before_writes(self):
        for value in ('present', 'hidden'):
            f = ConfigurationFixture()
            if value == 'present':
                f.rule['bypass_actors'] = [{'actor_id': M.APP}]
            else:
                f.rule.pop('bypass_actors')
            self.assertFalse(self.configure(f)['success'])
            self.assertFalse(any(m != 'GET' for m, p, b in f.calls))

    def test_unexpected_variable_and_missing_permissions_stop_before_writes(self):
        for target in (M.REPOSITORY_VARIABLE, M.STAGING_VARIABLE):
            f = ConfigurationFixture()
            f.variables[target]['value'] = 'unexpected'
            self.assertFalse(self.configure(f)['success'])
            self.assertFalse(any(m != 'GET' for m, p, b in f.calls))
            f = ConfigurationFixture()
            f.fail = ('GET', target)
            self.assertFalse(self.configure(f)['success'])
            self.assertFalse(any(m != 'GET' for m, p, b in f.calls))

    def test_partial_failure_resumes_without_redeployment(self):
        f = ConfigurationFixture()
        f.fail = ('PATCH', M.STAGING_VARIABLE)
        result = self.configure(f)
        self.assertFalse(result['success'])
        self.assertEqual(f.variables[M.REPOSITORY_VARIABLE]['value'], f.ref)
        f.fail = None
        f.calls.clear()
        self.assertTrue(self.configure(f)['success'])
        self.assertEqual([(m, p) for m, p, b in f.calls if m != 'GET'], [('PATCH', M.STAGING_VARIABLE)])

    def test_ambiguous_write_never_retries_or_leaks_raw_error(self):
        f = ConfigurationFixture()
        f.lose_response = True
        result = self.configure(f)
        self.assertFalse(result['success'])
        self.assertNotIn('NEVER_PRINT_TOKEN', json.dumps(result))
        self.assertEqual(len([c for c in f.calls if c[0] == 'PATCH']), 1)
        f.lose_response = False
        self.assertTrue(self.configure(f)['success'])

    def test_concurrent_change_is_not_overwritten(self):
        f = ConfigurationFixture()
        reads = 0
        def mutate(method, path, body):
            nonlocal reads
            if method == 'GET' and path == M.REPOSITORY_VARIABLE:
                reads += 1
                if reads == 2:
                    f.variables[path]['value'] = 'f' * 40
        f.mutate = mutate
        self.assertFalse(self.configure(f)['success'])
        self.assertFalse(any(m != 'GET' for m, p, b in f.calls))

    def test_installed_tree_or_staging_change_stops(self):
        for mutation in ('tree', 'staging', 'main'):
            f = ConfigurationFixture()
            original = f.api
            def api(method, path, auth=None, body=None):
                code, value = original(method, path, auth, body)
                if mutation == 'tree' and '/git/trees/' in path and M.BASE not in path:
                    value['tree'][0]['sha'] = 'f' * 40
                if mutation == 'staging' and path.endswith('/environments/staging'):
                    value['can_admins_bypass'] = True
                if mutation == 'main' and path.endswith('/git/ref/heads/main'):
                    value['object']['sha'] = 'f' * 40
                return code, value
            result = M.configure(f.ref, f.data, f.baseline, 'fake-never-print', api)
            self.assertFalse(result['success'])
            self.assertFalse(any(m != 'GET' for m, p, b in f.calls))

    def test_receipt_never_contains_keys_and_rejects_unrevoked_installation(self):
        f = ConfigurationFixture()
        with tempfile.TemporaryDirectory() as root:
            archive = Path(root) / 'fixed.zip'
            M.save_receipt(archive, {'commit': f.ref, 'refUpdated': True, 'tokenRevoked': False,
                                     'privateKey': 'NEVER_SAVE', 'token': 'NEVER_SAVE'})
            self.assertNotIn('NEVER_SAVE', M.receipt_path(archive).read_text())
            with patch.object(M, 'hidden', side_effect=AssertionError('must not request credentials')):
                with self.assertRaises(M.Stop):
                    M.finish(archive, f.data, f.baseline)

    def test_configuration_cannot_write_secrets_approvals_rules_or_other_variables(self):
        for method, path, body in [
            ('PATCH', M.REPO + '/rulesets/25676153', {}),
            ('PUT', M.REPO + '/environments/staging', {}),
            ('PATCH', M.REPO + '/git/refs/heads/ci-control', {'sha': 'd' * 40, 'force': False}),
            ('PATCH', M.REPO + '/actions/variables/PULBASE_PRODUCTION_ENABLED', {'name': 'PULBASE_PRODUCTION_ENABLED', 'value': 'true'}),
            ('PUT', M.REPO + '/environments/staging/secrets/OPENAI_API_KEY', {}),
            ('POST', M.REPO + '/actions/runs/123/pending_deployments', {}),
            ('POST', '/app/installations/123/access_tokens', {'permissions': {'variables': 'write'}}),
            ('DELETE', M.REPOSITORY_VARIABLE, None),
            ('PATCH', M.STAGING_VARIABLE, {'name': 'PULBASE_CONTROL_RULE_VERSIONS', 'value': json.dumps({'ciControl': '2026-11-04T00:00:00.000Z', 'main': M.MAIN_RULE_VERSION, 'protectionMode': 'maintenance'})}),
        ]:
            self.assertFalse(M.configuration_permitted(method, path, body))


class InstallTests(unittest.TestCase):
    def archive(self, mutate=lambda manifest: None):
        f = Fixture()
        manifest = {'version': 1, 'mode': 'automatic-resume-control-update-only',
                    'parent': M.BASE, 'workflowChanged': False, 'productionEnabled': False,
                    'baselineFiles': f.baseline,
                    'files': {p: hashlib.sha256(b).hexdigest() for p, b in f.data.items()}}
        mutate(manifest)
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            for p, b in f.data.items():
                archive.writestr(p, b)
            archive.writestr(M.MANIFEST, json.dumps(manifest))
        return output.getvalue(), f

    def test_bundle_replaces_pinned_files_without_installing_manifest(self):
        raw, f = self.archive()
        with tempfile.TemporaryDirectory() as root:
            p = Path(root) / 'bundle.zip'
            p.write_bytes(raw)
            with patch.object(M, 'BUNDLE_DIGEST', hashlib.sha256(raw).hexdigest()):
                data, baseline = M.bundle(p)
                self.assertEqual(data, f.data)
                self.assertEqual(set(data), M.FILES)
                self.assertEqual(len(baseline), 34)
                self.assertEqual(len(set(baseline) - set(data)), 34 - len(M.FILES))
                p.write_bytes(raw + b'tampered')
                with self.assertRaises(M.Stop):
                    M.bundle(p)

    def test_manifest_rejects_other_parent_production_or_missing_baseline(self):
        for change in [lambda m: m.update(parent='f' * 40), lambda m: m.update(productionEnabled=True),
                       lambda m: m.update(workflowChanged=True), lambda m: m['baselineFiles'].pop(next(iter(M.FILES))),
                       lambda m: m['files'].update({'extra.py': 'a' * 64})]:
            raw, _ = self.archive(change)
            with tempfile.TemporaryDirectory() as root:
                p = Path(root) / 'bundle.zip'
                p.write_bytes(raw)
                with patch.object(M, 'BUNDLE_DIGEST', hashlib.sha256(raw).hexdigest()):
                    with self.assertRaises(M.Stop):
                        M.bundle(p)

    def apply(self, f):
        with patch.object(M, 'APPLY_RULE_VERSION', '2026-10-29T00:00:00.000Z'):
            return M.apply(f.data, f.baseline, 'fake-jwt', f.api)

    def test_only_pinned_files_replaced_and_token_revoked(self):
        f = Fixture()
        result = self.apply(f)
        self.assertTrue(result['success'])
        self.assertTrue(result['tokenRevoked'])
        self.assertEqual([(m, p) for m, p, b in f.calls if m == 'PATCH'], [('PATCH', M.REPO + '/git/refs/heads/ci-control')])
        self.assertEqual(f.calls[-1][:2], ('DELETE', '/installation/token'))
        self.assertFalse(result['workflowStarted'])
        self.assertFalse(result['deploymentRequested'])

    def test_apply_disabled_before_version_is_reviewed(self):
        f = Fixture()
        with patch.object(M, 'APPLY_RULE_VERSION', None):
            result = M.apply(f.data, f.baseline, 'fake-jwt', f.api)
        self.assertFalse(result['success'])
        self.assertEqual(f.calls, [])

    def test_permissions_ref_workflow_main_and_deploy_api_denied(self):
        for method, path, body in [
            ('PATCH', M.REPO + '/git/refs/heads/main', {'sha': 'd' * 40, 'force': False}),
            ('PATCH', M.REPO + '/git/refs/heads/develop', {'sha': 'd' * 40, 'force': False}),
            ('PATCH', M.REPO + '/git/refs/heads/ci-control', {'sha': 'd' * 40, 'force': True}),
            ('POST', M.REPO + '/actions/workflows/x.yml/dispatches', {'ref': 'ci-control'}),
            ('POST', '/app/installations/123/access_tokens', {'repositories': ['virtual_gamecenter'], 'permissions': {'contents': 'write', 'workflows': 'write'}}),
        ]:
            self.assertFalse(M.permitted(method, path, body))
        entries = [{'path': p, 'mode': '100644', 'type': 'blob', 'content': ''} for p in M.FILES]
        entries[0]['path'] = '.github/workflows/postmerge-staging.yml'
        self.assertFalse(M.permitted('POST', M.REPO + '/git/trees', {'base_tree': 'b' * 40, 'tree': entries}))

    def test_failed_commit_revokes_token_without_updating_ref(self):
        f = Fixture()
        f.fail = ('POST', M.REPO + '/git/commits')
        result = self.apply(f)
        self.assertFalse(result['success'])
        self.assertTrue(result['tokenRevoked'])
        self.assertFalse(any(m == 'PATCH' for m, p, b in f.calls))

    def test_changed_guard_before_ref_update_stops(self):
        f = Fixture()
        f.mutate = lambda m, p, b: f.rule.update(updated_at='changed') if m == 'POST' and p.endswith('/git/commits') else None
        result = self.apply(f)
        self.assertFalse(result['success'])
        self.assertTrue(result['tokenRevoked'])
        self.assertFalse(any(m == 'PATCH' for m, p, b in f.calls))

    def test_unknown_ref_outcome_never_retries(self):
        f = Fixture()
        def failure(method, path, body):
            if method == 'PATCH':
                raise TimeoutError('secret-failure-do-not-print')
        f.mutate = failure
        result = self.apply(f)
        self.assertTrue(result['refOutcomeUnknown'])
        self.assertTrue(result['tokenRevoked'])
        self.assertEqual(sum(m == 'PATCH' for m, p, b in f.calls), 1)
        self.assertNotIn('secret-failure', json.dumps(result))

    def test_tree_tampering_rejected(self):
        f = Fixture()
        original = f.tree
        f.tree = lambda expected: original(expected | {'extra.py': 'a' * 40})
        result = self.apply(f)
        self.assertFalse(result['success'])
        self.assertFalse(any(m == 'PATCH' for m, p, b in f.calls))


if __name__ == '__main__':
    unittest.main()
