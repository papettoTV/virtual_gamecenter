import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'install-production-inspection.py'
spec = importlib.util.spec_from_file_location('installer', path)
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)


class Fixture:
    def __init__(self):
        self.baseline = {'old/' + str(i): 'a' * 40 for i in range(28)}
        self.data = {p: b'content' for p in M.FILES | {M.MANIFEST}}
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


class InstallTests(unittest.TestCase):
    def apply(self, f):
        with patch.object(M, 'APPLY_RULE_VERSION', '2026-10-29T00:00:00.000Z'):
            return M.apply(f.data, f.baseline, 'fake-jwt', f.api)

    def test_only_additive_control_update_and_token_revocation(self):
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
        entries = [{'path': p, 'mode': '100644', 'type': 'blob', 'content': ''} for p in M.FILES | {M.MANIFEST}]
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
