import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location('bootstrap', Path(__file__).resolve().parents[1] / 'update-trusted-runtime.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class Fixture:
    def __init__(self):
        self.entries = {name: (name + '\n').encode() for name in M.FILES | {'bundle-manifest.json'}}
        self.calls = []
        self.ref = M.PREVIOUS_SHA
        self.mutation = lambda *_: None
        self.develop = 'b' * 40
        self.rules = {'target': 'branch', 'name': 'ci-control-human-managed', 'enforcement': 'active',
            'updated_at': '2026-10-23T00:00:00.000Z',
            'bypass_actors': [{'actor_id': M.APP, 'actor_type': 'Integration', 'bypass_mode': 'always'}],
            'conditions': {'ref_name': {'include': ['refs/heads/ci-control'], 'exclude': []}},
            'rules': [{'type': name} for name in ('creation', 'update', 'deletion', 'non_fast_forward')]}
        self.created_token = {'token': 'fake-token-do-not-print', 'permissions': {'contents': 'write', 'workflows': 'write', 'metadata': 'read'}}
        self.app = {'id': M.APP, 'slug': 'pulbase-release', 'owner': {'login': 'papettoTV'}, 'permissions': {'contents': 'write', 'workflows': 'write'}}

    def api(self, method, path, auth=None, body=None):
        if not M.permitted(method, path, body):
            raise AssertionError('Unexpected API: ' + method + ' ' + path)
        self.calls.append((method, path))
        self.mutation(method, path)
        if method == 'DELETE':
            return 204, None
        if method == 'GET':
            if path.endswith('/rulesets/25676153'):
                return 200, self.rules
            if path.endswith('/rulesets/25520943'):
                return 200, {'target': 'branch', 'enforcement': 'active', 'bypass_actors': [],
                    'updated_at': M.MAIN_RULE_VERSION,
                    'conditions': {'ref_name': {'include': ['refs/heads/main'], 'exclude': []}}, 'rules': [{'type': 'update'}]}
            if path.endswith('/environments/staging'):
                return 200, {'can_admins_bypass': False, 'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True},
                    'protection_rules': [{'type': 'required_reviewers', 'reviewers': [{'type': 'User', 'reviewer': {'login': 'papettoTV'}}]}]}
            if 'deployment-branch-policies' in path:
                return 200, {'total_count': 1, 'branch_policies': [{'name': 'ci-control', 'type': 'branch'}]}
            if path.endswith('/git/ref/heads/ci-control'):
                return (200, {'object': {'sha': self.ref}}) if self.ref else (404, None)
            if path.endswith('/git/ref/heads/main'):
                return 200, {'object': {'sha': M.MAIN_SHA}}
            if path.endswith('/git/ref/heads/develop'):
                return 200, {'object': {'sha': self.develop}}
            if path == '/app':
                return 200, self.app
            if path == M.REPO + '/installation':
                return 200, {'id': 42, 'app_id': M.APP, 'suspended_at': None}
            if path == M.REPO:
                return 200, {'id': 123, 'full_name': 'papettoTV/virtual_gamecenter', 'default_branch': 'develop', 'fork': False}
            if path == '/installation/repositories':
                return 200, {'total_count': 1, 'repositories': [{'id': 123, 'full_name': 'papettoTV/virtual_gamecenter'}]}
            if '/git/trees/' in path:
                return 200, {'sha': 'c' * 40, 'truncated': False, 'tree': [
                    {'path': name, 'type': 'blob', 'mode': '100644', 'sha': M.git_blob(data)} for name, data in self.entries.items()]}
        if path == '/app/installations/42/access_tokens':
            return 201, self.created_token
        if path.endswith('/git/trees'):
            return 201, {'sha': 'c' * 40}
        if path.endswith('/git/commits'):
            return 201, {'sha': 'd' * 40, 'tree': {'sha': body['tree']}, 'parents': [{'sha': body['parents'][0]}]}
        if method == 'PATCH' and path.endswith('/git/refs/heads/ci-control'):
            self.ref = body['sha']
            return 200, {'ref': 'refs/heads/ci-control', 'object': {'sha': self.ref}}
        raise AssertionError(path)

    def run(self):
        return M.apply(self.entries, 'fake-jwt-do-not-print', self.api)


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.version = patch.object(M, 'APPLY_CONTROL_VERSION', '2026-10-23T00:00:00.000Z')
        self.version.start()
        self.addCleanup(self.version.stop)

    def test_only_ci_control_is_fast_forward_updated_and_token_is_revoked(self):
        f = Fixture()
        value = f.run()
        self.assertTrue(value['success'])
        self.assertTrue(value['refUpdated'])
        self.assertEqual(value['commit'], 'd' * 40)
        self.assertEqual(f.calls[-1], ('DELETE', '/installation/token'))
        self.assertFalse(value['mainRefWriteRequested'])
        self.assertFalse(value['developRefWriteRequested'])
        self.assertNotIn('fake-token', json.dumps(value))
        self.assertNotIn('fake-jwt', json.dumps(value))

    def test_changed_control_is_not_overwritten(self):
        f = Fixture(); f.ref = 'e' * 40
        value = f.run()
        self.assertFalse(value['success'])
        self.assertFalse(any(method != 'GET' for method, _ in f.calls))

    def test_no_admin_or_implementation_app_bypass_is_accepted(self):
        for bypass in ([], [{'actor_id': 5, 'actor_type': 'RepositoryRole', 'bypass_mode': 'always'}],
                       [{'actor_id': 5403155, 'actor_type': 'Integration', 'bypass_mode': 'always'}]):
            f = Fixture(); f.rules['bypass_actors'] = bypass
            self.assertFalse(f.run()['success'])
            self.assertFalse(any(method != 'GET' for method, _ in f.calls))

    def test_wrong_or_privileged_app_stops_before_token_issue(self):
        for change in ({'id': 5403155}, {'permissions': {'contents': 'write', 'workflows': 'write', 'administration': 'write'}}):
            f = Fixture(); f.app.update(change)
            self.assertFalse(f.run()['success'])
            self.assertFalse(any('/access_tokens' in path for _, path in f.calls))

    def test_excess_token_permissions_are_revoked_without_git_write(self):
        f = Fixture(); f.created_token['permissions']['administration'] = 'write'
        value = f.run()
        self.assertFalse(value['success']); self.assertTrue(value['tokenRevoked'])
        self.assertFalse(any(method == 'POST' and '/git/' in path for method, path in f.calls))

    def test_ambiguous_repository_scope_is_revoked(self):
        f = Fixture(); original = f.api
        def api(method, path, auth=None, body=None):
            if path == '/installation/repositories':
                return 200, {'total_count': 2, 'repositories': []}
            return original(method, path, auth, body)
        value = M.apply(f.entries, 'fake-jwt', api)
        self.assertFalse(value['success']); self.assertTrue(value['tokenRevoked'])
        self.assertEqual(f.ref, M.PREVIOUS_SHA)

    def test_tree_hash_mismatch_stops_before_branch_creation(self):
        f = Fixture(); original = f.api
        def api(method, path, auth=None, body=None):
            code, data = original(method, path, auth, body)
            if method == 'GET' and '/git/trees/' in path:
                data['tree'][0]['mode'] = '120000'
            return code, data
        value = M.apply(f.entries, 'fake-jwt', api)
        self.assertFalse(value['success']); self.assertTrue(value['tokenRevoked']); self.assertEqual(f.ref, M.PREVIOUS_SHA)

    def test_control_moving_before_update_stops(self):
        f = Fixture()
        def mutate(method, path):
            if method == 'POST' and path.endswith('/git/commits'):
                f.ref = 'e' * 40
        f.mutation = mutate
        value = f.run()
        self.assertFalse(value['success']); self.assertEqual(f.ref, 'e' * 40); self.assertTrue(value['tokenRevoked'])

    def test_ref_creation_timeout_is_unknown_and_never_retried(self):
        f = Fixture(); original = f.api
        def api(method, path, auth=None, body=None):
            code, data = original(method, path, auth, body)
            if method == 'PATCH' and path.endswith('/git/refs/heads/ci-control'):
                raise RuntimeError('fake-secret-network-details')
            return code, data
        value = M.apply(f.entries, 'fake-jwt', api)
        self.assertFalse(value['success']); self.assertTrue(value['refOutcomeUnknown']); self.assertTrue(value['tokenRevoked'])
        self.assertEqual(f.calls.count(('PATCH', M.REPO + '/git/refs/heads/ci-control')), 1)
        self.assertNotIn('fake-secret', json.dumps(value))

    def test_revocation_failure_is_not_reported_as_success(self):
        f = Fixture(); original = f.api
        def api(method, path, auth=None, body=None):
            return (500, None) if method == 'DELETE' else original(method, path, auth, body)
        value = M.apply(f.entries, 'fake-jwt', api)
        self.assertFalse(value['success']); self.assertFalse(value['tokenRevoked']); self.assertTrue(value['refUpdated'])

    def test_api_never_updates_main_develop_rules_secrets_or_workflows(self):
        for method, path, body in [('PATCH', M.REPO + '/git/refs/heads/main', {'sha': 'a' * 40}),
            ('POST', M.REPO + '/git/refs', {'ref': 'refs/heads/main', 'sha': 'a' * 40}),
            ('POST', M.REPO + '/git/refs', {'ref': 'refs/heads/develop', 'sha': 'a' * 40}),
            ('PATCH', M.REPO + '/rulesets/25676153', {}), ('PUT', M.REPO + '/environments/staging', {}),
            ('PUT', M.REPO + '/actions/secrets/KEY', {}), ('POST', M.REPO + '/actions/workflows/1/dispatches', {}),
            ('POST', '/repos/other/repo/git/refs', {'ref': 'refs/heads/ci-control', 'sha': 'a' * 40})]:
            self.assertFalse(M.permitted(method, path, body))
            with self.assertRaises(M.Stop):
                M.request(method, path, 'fake', body)

    def test_force_and_wrong_parent_are_rejected(self):
        self.assertFalse(M.permitted('PATCH', M.REPO + '/git/refs/heads/ci-control', {'sha': 'a' * 40, 'force': True}))
        self.assertFalse(M.permitted('PATCH', M.REPO + '/git/refs/heads/develop', {'sha': 'a' * 40, 'force': False}))
        self.assertFalse(M.permitted('POST', M.REPO + '/git/commits', {'message': 'chore: レビュー信頼条件と鍵なし実処理を配置', 'tree': 'a' * 40, 'parents': ['a' * 40]}))

    def test_bundle_is_hash_pinned_and_manifest_checked(self):
        entries = {name: b'public-code\n' for name in M.FILES}
        manifest = {'version': 3, 'mode': 'trust-and-runtime-preparation', 'liveTransportConnected': False, 'previousControlSha': M.PREVIOUS_SHA, 'repository': 'papettoTV/virtual_gamecenter',
            'branch': 'ci-control', 'deploymentEnabled': False, 'files': {name: hashlib.sha256(data).hexdigest() for name, data in entries.items()}}
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / 'bundle.zip'
            with zipfile.ZipFile(archive, 'w') as out:
                for name, data in entries.items(): out.writestr(name, data)
                out.writestr('bundle-manifest.json', json.dumps(manifest))
            with self.assertRaises(M.Stop): M.bundle(archive)
            with patch.object(M, 'BUNDLE_SHA', hashlib.sha256(archive.read_bytes()).hexdigest()):
                self.assertEqual(set(M.bundle(archive)), M.FILES | {'bundle-manifest.json'})

    def test_jwt_uses_private_key_path_without_printing_or_key_arguments(self):
        with patch.object(M.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=b'signature')) as run:
            jwt = M.sign_jwt(Path('/human-only/key.pem'))
            self.assertEqual(run.call_args.args[0], ['/usr/bin/openssl', 'dgst', '-sha256', '-sign', '/human-only/key.pem'])
            claims = json.loads(base64.urlsafe_b64decode(jwt.split('.')[1] + '=='))
            self.assertEqual(claims['iss'], M.APP); self.assertEqual(claims['exp'] - claims['iat'], 600)

    def test_non_tty_apply_never_requests_private_key_or_network(self):
        with patch.object(M.sys, 'argv', ['helper', '--apply', 'bundle.zip']), patch.object(M, 'bundle', return_value={}), \
             patch.object(M.sys.stdin, 'isatty', return_value=False), patch.object(M, 'request') as api, \
             patch.object(M.getpass, 'getpass') as prompt:
            with self.assertRaises(M.Stop): M.main()
            api.assert_not_called(); prompt.assert_not_called()

    def test_hidden_bypass_requires_the_pinned_human_verified_version(self):
        f = Fixture(); del f.rules['bypass_actors']
        self.assertTrue(f.run()['success'])
        f = Fixture(); del f.rules['bypass_actors']; f.rules['updated_at'] = '2026-10-24T00:00:00.000Z'
        self.assertFalse(f.run()['success']); self.assertEqual(f.ref, M.PREVIOUS_SHA)

    def test_apply_stays_disabled_until_human_exception_version_is_read(self):
        f = Fixture()
        with patch.object(M, 'APPLY_CONTROL_VERSION', None):
            self.assertFalse(f.run()['success'])
        self.assertFalse(any(method != 'GET' for method, _ in f.calls))


if __name__ == '__main__':
    unittest.main()
