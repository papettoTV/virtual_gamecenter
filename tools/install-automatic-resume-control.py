#!/usr/bin/env python3
"""Human-terminal-only replacement of pinned trust and browser regression files. No workflow changes."""
import base64
from datetime import datetime, timezone
import getpass
import hashlib
import io
import os
import tempfile
import json
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
import warnings
import zipfile

REPO = '/repos/papettoTV/virtual_gamecenter'
BASE = '828ac87708a57a208b9f06cf55f1b479a51ce492'
MAIN = '73cb5d9267c56f06f9f1150327ec6b8b3caa2bb9'
APP = 5405029
BUNDLE_DIGEST = 'PACKAGED_BUNDLE_DIGEST'
APPLY_RULE_VERSION = None  # Pin only after the sole human-managed App bypass is verified.
STRICT_RULE_VERSION = '2026-11-05T21:06:15.947Z'
MAIN_RULE_VERSION = '2026-10-21T20:32:35.191Z'
MANIFEST = 'automatic-resume-installation.json'
FILES = {'ci/control/review-trust.mjs', 'ci/control/review-trust.json', 'ci/production-candidate/policy.json',
         'ci/control/toolchain/browser/regression.spec.mjs'}
SHA = re.compile(r'^[a-f0-9]{40}$')
MESSAGE = 'ci: 信頼定義3件と検証回帰1件を更新（公開なし）'


class Stop(RuntimeError):
    pass


def need(value, message):
    if not value:
        raise Stop(message)


def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def bundle(path):
    need(path.is_file() and not path.is_symlink() and path.stat().st_size <= 1024 * 1024, '配置ZIPが不正です。')
    raw = path.read_bytes()
    need(hashlib.sha256(raw).hexdigest() == BUNDLE_DIGEST, 'レビュー済みZIPのSHA-256と一致しません。')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        need(len(entries) == len(FILES) + 1 and {x.filename for x in entries} == FILES | {MANIFEST}, '配置ファイル集合が不正です。')
        need(all(not x.is_dir() and not stat.S_ISLNK(x.external_attr >> 16) and not x.flag_bits & 1
                 and x.file_size < 256 * 1024 for x in entries), '配置ZIPのリンク・サイズが不正です。')
        data = {x.filename: archive.read(x) for x in entries}
    manifest = json.loads(data[MANIFEST])
    need(manifest.get('version') == 1 and manifest.get('mode') == 'automatic-resume-control-update-only'
         and manifest.get('parent') == BASE and set(manifest.get('files', {})) == FILES
         and manifest.get('workflowChanged') is False and manifest.get('productionEnabled') is False,
         '配置manifestが不正です。')
    need(all(hashlib.sha256(data[p]).hexdigest() == h for p, h in manifest['files'].items()), '配置ファイルのハッシュが不一致です。')
    baseline = manifest.get('baselineFiles', {})
    need(len(baseline) == 34 and all(SHA.fullmatch(h) for h in baseline.values()) and FILES <= set(baseline) and MANIFEST not in baseline, '既存制御の固定一覧が不正です。')
    del data[MANIFEST]  # Review metadata is never installed into ci-control.
    return data, baseline


def permitted(method, path, body):
    if method == 'GET':
        return path in {REPO, '/app', REPO + '/installation', '/installation/repositories',
                        REPO + '/rulesets/25676153', REPO + '/rulesets/25520943',
                        REPO + '/environments/staging', REPO + '/environments/staging/deployment-branch-policies?per_page=100'} or bool(
            re.fullmatch(re.escape(REPO) + r'/git/(ref/heads/(main|develop|ci-control)|commits/[a-f0-9]{40}|trees/[a-f0-9]{40}\?recursive=1)', path))
    if method == 'DELETE':
        return path == '/installation/token' and body is None
    if not isinstance(body, dict):
        return False
    if method == 'PATCH':
        return path == REPO + '/git/refs/heads/ci-control' and set(body) == {'sha', 'force'} and bool(SHA.fullmatch(body.get('sha', ''))) and body['force'] is False
    if method != 'POST':
        return False
    if re.fullmatch(r'/app/installations/[1-9][0-9]*/access_tokens', path):
        return body == {'repositories': ['virtual_gamecenter'], 'permissions': {'contents': 'write'}}
    if path == REPO + '/git/trees':
        entries = body.get('tree', [])
        return set(body) == {'base_tree', 'tree'} and bool(SHA.fullmatch(body.get('base_tree', ''))) and len(entries) == len(FILES) and all(
            set(x) == {'path', 'mode', 'type', 'content'} and x['path'] in FILES
            and x['mode'] == '100644' and x['type'] == 'blob' and isinstance(x['content'], str) for x in entries) and len({x['path'] for x in entries}) == len(FILES)
    if path == REPO + '/git/commits':
        return set(body) == {'message', 'tree', 'parents'} and body['message'] == MESSAGE and body['parents'] == [BASE] and bool(SHA.fullmatch(body.get('tree', '')))
    return False


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(method, path, auth=None, body=None, policy=permitted):
    need(policy(method, path, body), '対象外のAPI操作を拒否しました。')
    headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'}
    if auth:
        headers['Authorization'] = 'Bearer ' + auth
    req = urllib.request.Request('https://api.github.com' + path, method=method, headers=headers,
                                 data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None)
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=20) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
            need(len(raw) <= 2 * 1024 * 1024, 'API応答のサイズ制限を超えました。')
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        code = error.code
        error.close()
        return code, None
    except Stop:
        raise
    except Exception:
        raise Stop('GitHubに接続できません。認証・API応答は表示しません。') from None



def canonical_rule_time(value):
    # Match equivalent RFC3339 instants, preserving millisecond precision.
    # Naive/invalid timestamps and finer precision are deliberately not accepted.
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)', value):
        return value
    try:
        instant = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return instant.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    except ValueError:
        return value

def ok(api, method, path, auth=None, body=None):
    code, value = api(method, path, auth, body)
    need(code in (200, 201, 204), 'GitHub API確認に失敗しました（HTTP ' + str(code) + '）。再試行せず状態を確認してください。')
    if path in (REPO + '/rulesets/25676153', REPO + '/rulesets/25520943') and isinstance(value, dict):
        value = dict(value, updated_at=canonical_rule_time(value.get('updated_at')))
    return value


def tree_matches(tree, expected):
    need(tree.get('truncated') is False and isinstance(tree.get('tree'), list), 'tree一覧が不完全です。')
    entries = tree['tree']
    leaves = [x for x in entries if x.get('type') != 'tree']
    need(len(leaves) == len(expected) and all(x.get('type') == 'blob' and x.get('mode') == '100644' for x in leaves)
         and {x['path']: x['sha'] for x in leaves} == expected, '既存ファイルの変更・削除・想定外ファイルを検出しました。')


def guards(api, baseline, applying, token=None, *, revision=BASE, strict_version=STRICT_RULE_VERSION, require_bypass_list=False, apply_version=None):
    version = (apply_version or APPLY_RULE_VERSION) if applying else strict_version
    need(isinstance(version, str), '人が確認した一時例外の設定版が未固定です。配置は無効です。')
    rule = ok(api, 'GET', REPO + '/rulesets/25676153', token)
    expected = [{'actor_id': APP, 'actor_type': 'Integration', 'bypass_mode': 'always'}] if applying else []
    # Public/App reads may omit the bypass list. The reviewed exact version is pinned
    # only after the limited owner read has independently checked the complete list.
    checks = {
        'ブランチルール': rule.get('target') == 'branch',
        'Active': rule.get('enforcement') == 'active',
        '設定版': rule.get('updated_at') == version,
        'bypass一覧の可視性': not require_bypass_list or 'bypass_actors' in rule,
        'bypass一致': 'bypass_actors' not in rule or rule['bypass_actors'] == expected,
        '対象ブランチ': rule.get('conditions', {}).get('ref_name', {}).get('include') == ['refs/heads/ci-control'],
        '除外ブランチ': all(x in ('refs/heads/main', 'refs/heads/develop') for x in rule.get('conditions', {}).get('ref_name', {}).get('exclude', [])),
        '禁止ルール4件': {'creation', 'update', 'deletion', 'non_fast_forward'} <= {x['type'] for x in rule.get('rules', [])}}
    need(all(checks.values()), 'ci-controlの保護・設定版が不一致です（不一致: ' + '、'.join(k for k, v in checks.items() if not v) + '）。')
    main = ok(api, 'GET', REPO + '/rulesets/25520943', token)
    need(main.get('target') == 'branch' and main.get('enforcement') == 'active' and main.get('updated_at') == MAIN_RULE_VERSION
         and (not require_bypass_list or 'bypass_actors' in main)
         and ('bypass_actors' not in main or main['bypass_actors'] == [])
         and main.get('conditions', {}).get('ref_name') == {'include': ['refs/heads/main'], 'exclude': []}
         and any(x['type'] == 'update' for x in main.get('rules', [])), 'mainの更新禁止が不一致です。')
    need(ok(api, 'GET', REPO + '/git/ref/heads/main', token)['object']['sha'] == MAIN, 'mainが準備時のSHAから変わりました。')
    need(ok(api, 'GET', REPO + '/git/ref/heads/ci-control', token)['object']['sha'] == revision, 'ci-controlが想定のSHAと不一致です。')
    tree_matches(ok(api, 'GET', REPO + '/git/trees/' + revision + '?recursive=1', token), baseline)
    env = ok(api, 'GET', REPO + '/environments/staging', token)
    reviewers = [x for x in env.get('protection_rules', []) if x.get('type') == 'required_reviewers']
    need(env.get('can_admins_bypass') is False and env.get('deployment_branch_policy') == {'protected_branches': False, 'custom_branch_policies': True}
         and len(reviewers) == 1 and len(reviewers[0].get('reviewers', [])) == 1
         and reviewers[0]['reviewers'][0].get('type') == 'User' and reviewers[0]['reviewers'][0]['reviewer']['login'] == 'papettoTV', 'stagingの承認条件が不一致です。')
    branches = ok(api, 'GET', REPO + '/environments/staging/deployment-branch-policies?per_page=100', token)
    need(branches.get('total_count') == 1 and len(branches.get('branch_policies', [])) == 1
         and branches['branch_policies'][0]['name'] == 'ci-control' and branches['branch_policies'][0]['type'] == 'branch', 'stagingがci-control限定ではありません。')


def apply(data, baseline, jwt, api=request, *, rule_version=None):
    token = None
    report = {'mode': 'automatic-resume-control-update-only', 'stage': 'preflight', 'commit': None, 'refUpdated': False,
              'tokenRevoked': None, 'mainRefWriteRequested': False, 'developRefWriteRequested': False,
              'workflowStarted': False, 'workflowChanged': False, 'deploymentRequested': False}
    try:
        guards(api, baseline, True, apply_version=rule_version)
        app = ok(api, 'GET', '/app', jwt)
        need(app.get('id') == APP and app.get('slug') == 'pulbase-release' and app.get('owner', {}).get('login') == 'papettoTV', '配置用Appが不一致です。')
        installation = ok(api, 'GET', REPO + '/installation', jwt)
        need(installation.get('app_id') == APP and not installation.get('suspended_at') and isinstance(installation.get('id'), int), 'Appのインストールが不一致です。')
        created = ok(api, 'POST', '/app/installations/' + str(installation['id']) + '/access_tokens', jwt,
                     {'repositories': ['virtual_gamecenter'], 'permissions': {'contents': 'write'}})
        token = created.get('token')
        need(isinstance(token, str) and token and created.get('permissions', {}).get('contents') == 'write'
             and set(created['permissions']) <= {'contents', 'metadata'} and created['permissions'].get('metadata', 'read') == 'read', '一時トークンの権限が不一致です。')
        accessible = ok(api, 'GET', '/installation/repositories', token)
        need(accessible.get('total_count') == 1 and len(accessible.get('repositories', [])) == 1
             and accessible['repositories'][0]['full_name'] == 'papettoTV/virtual_gamecenter', '一時トークンの対象が不一致です。')
        parent = ok(api, 'GET', REPO + '/git/commits/' + BASE, token)
        need(SHA.fullmatch(parent.get('tree', {}).get('sha', '')), '親treeが不正です。')
        report['stage'] = 'create-tree'
        tree = ok(api, 'POST', REPO + '/git/trees', token, {'base_tree': parent['tree']['sha'], 'tree': [
            {'path': p, 'mode': '100644', 'type': 'blob', 'content': b.decode('utf-8')} for p, b in sorted(data.items())]})
        need(SHA.fullmatch(tree.get('sha', '')), '作成treeの識別子が不正です。')
        tree_matches(ok(api, 'GET', REPO + '/git/trees/' + tree['sha'] + '?recursive=1', token), baseline | {p: blob(b) for p, b in data.items()})
        report['stage'] = 'create-commit'
        commit = ok(api, 'POST', REPO + '/git/commits', token, {'message': MESSAGE, 'tree': tree['sha'], 'parents': [BASE]})
        need(SHA.fullmatch(commit.get('sha', '')) and commit.get('tree', {}).get('sha') == tree['sha']
             and [x.get('sha') for x in commit.get('parents', [])] == [BASE], '作成commitの親・treeが不一致です。')
        report['commit'] = commit['sha']
        report['stage'] = 'recheck-before-update'
        guards(api, baseline, True, token, apply_version=rule_version)
        report['stage'] = 'update-ref'
        value = ok(api, 'PATCH', REPO + '/git/refs/heads/ci-control', token, {'sha': commit['sha'], 'force': False})
        need(value.get('ref') == 'refs/heads/ci-control' and value.get('object', {}).get('sha') == commit['sha'], 'ref更新の結果が不明です。再実行しないでください。')
        report['refUpdated'] = True
        need(ok(api, 'GET', REPO + '/git/ref/heads/main', token)['object']['sha'] == MAIN, 'mainが変わりました。')
        need(ok(api, 'GET', REPO + '/git/ref/heads/ci-control', token)['object']['sha'] == commit['sha'], '配置後のrefが不一致です。')
        report['stage'] = 'complete'
    except Exception as error:
        report['stopped'] = True
        report['reason'] = str(error) if isinstance(error, Stop) else '配置の確認に失敗しました。秘密情報は表示しません。'
        report['refOutcomeUnknown'] = report['stage'] == 'update-ref' and not report['refUpdated']
    finally:
        if token:
            try:
                report['tokenRevoked'] = api('DELETE', '/installation/token', token, None)[0] == 204
            except Exception:
                report['tokenRevoked'] = False
        report['success'] = report['stage'] == 'complete' and report['tokenRevoked'] is True
    return report


def sign(pem):
    b64 = lambda data: base64.urlsafe_b64encode(data).rstrip(b'=')
    now = int(time.time())
    payload = b64(b'{"alg":"RS256","typ":"JWT"}') + b'.' + b64(json.dumps({'iat': now - 60, 'exp': now + 540, 'iss': APP}).encode())
    result = subprocess.run(['/usr/bin/openssl', 'dgst', '-sha256', '-sign', str(pem)], input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
    need(result.returncode == 0 and result.stdout, '人が保管する鍵で署名できません。詳細は表示しません。')
    return (payload + b'.' + b64(result.stdout)).decode()



REPOSITORY_VARIABLE = REPO + '/actions/variables/PULBASE_CONTROL_EVIDENCE_SHA'
STAGING_VARIABLE = REPO + '/environments/staging/variables/PULBASE_CONTROL_RULE_VERSIONS'
ISO_VERSION = re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$')


def configuration_permitted(method, path, body):
    # A separate human credential can only reach these two variable endpoints.
    # Environment protection, secrets, deployment approvals and refs are never writable.
    if method == 'GET':
        return path in (REPOSITORY_VARIABLE, STAGING_VARIABLE) or permitted(method, path, body)
    if method != 'PATCH' or not isinstance(body, dict) or set(body) != {'name', 'value'}:
        return False
    if path == REPOSITORY_VARIABLE:
        return body['name'] == 'PULBASE_CONTROL_EVIDENCE_SHA' and isinstance(body['value'], str) and bool(SHA.fullmatch(body['value']))
    if path == STAGING_VARIABLE and body['name'] == 'PULBASE_CONTROL_RULE_VERSIONS':
        try:
            value = json.loads(body['value'])
            return (set(value) == {'ciControl', 'main', 'protectionMode'}
                    and isinstance(value['ciControl'], str) and bool(ISO_VERSION.fullmatch(value['ciControl']))
                    and value['main'] == MAIN_RULE_VERSION and value['protectionMode'] == 'strict')
        except (TypeError, ValueError):
            return False
    return False


def configuration_request(method, path, auth=None, body=None):
    return request(method, path, auth, body, policy=configuration_permitted)


def strict_configuration_guards(api, token, commit, data, baseline, *, installed=True):
    need(bool(SHA.fullmatch(commit)) and (commit != BASE if installed else commit == BASE), '配置先のcommitが不正です。')
    rule = ok(api, 'GET', REPO + '/rulesets/25676153', token)
    version = rule.get('updated_at', '')
    need(isinstance(version, str) and bool(ISO_VERSION.fullmatch(version)) and version != APPLY_RULE_VERSION
         and rule.get('bypass_actors') == [], 'bypassが空であることを管理者読取権限で確認できません。変数は更新しません。')
    expected_tree = baseline | {p: blob(b) for p, b in data.items()} if installed else baseline
    guards(api, expected_tree, False, token, revision=commit, strict_version=version, require_bypass_list=True)
    need(ok(api, 'GET', REPO + '/rulesets/25676153', token) == rule, '確認中に保護設定が変わりました。')
    commit_value = ok(api, 'GET', REPO + '/git/commits/' + commit, token)
    need(not installed or [x.get('sha') for x in commit_value.get('parents', [])] == [BASE], '配置commitの親が不一致です。')
    need(bool(SHA.fullmatch(commit_value.get('tree', {}).get('sha', ''))), '配置treeが不正です。')
    tree_matches(ok(api, 'GET', REPO + '/git/trees/' + commit_value['tree']['sha'] + '?recursive=1', token), expected_tree)
    return {'ciControl': version, 'main': MAIN_RULE_VERSION, 'protectionMode': 'strict'}


def variable_value(api, token, path, name):
    value = ok(api, 'GET', path, token)
    need(isinstance(value, dict) and value.get('name') == name and isinstance(value.get('value'), str), '既存変数を確認できません。新規作成や代用はしません。')
    return value['value']


def configure(commit, data, baseline, token, api=configuration_request, *, installed=True):
    report = {'mode': 'human-configuration-only', 'commit': commit, 'stage': 'strict-preflight',
              'variablesVerified': False, 'updatedVariables': [], 'credentialSaved': False,
              'bypassChanged': False, 'mainRefWriteRequested': False, 'developRefWriteRequested': False,
              'workflowStarted': False, 'deploymentRequested': False, 'success': False}
    try:
        versions = strict_configuration_guards(api, token, commit, data, baseline, installed=installed)
        paths = [(REPOSITORY_VARIABLE, 'PULBASE_CONTROL_EVIDENCE_SHA', commit),
                 (STAGING_VARIABLE, 'PULBASE_CONTROL_RULE_VERSIONS', json.dumps(versions, separators=(',', ':')))]
        # Read BOTH before either write. Never replace an unexpected third-party value.
        current = [variable_value(api, token, path, name) for path, name, target in paths]
        need(current[0] in (BASE, commit), '制御SHA変数が想定外です。上書きしません。')
        old_versions = {'ciControl': STRICT_RULE_VERSION, 'main': MAIN_RULE_VERSION, 'protectionMode': 'strict'}
        need(json.loads(current[1]) in (old_versions, versions), '保護設定版変数が想定外です。上書きしません。')
        for index, (path, name, target) in enumerate(paths):
            report['stage'] = 'update-' + name
            need(strict_configuration_guards(api, token, commit, data, baseline, installed=installed) == versions, '保護設定版が変わりました。')
            need(variable_value(api, token, path, name) == current[index], '確認後に変数が変更されました。上書きしません。')
            matches = current[index] == target if index == 0 else json.loads(current[index]) == versions
            if not matches:
                ok(api, 'PATCH', path, token, {'name': name, 'value': target})
                report['updatedVariables'].append(name)
            saved = variable_value(api, token, path, name)
            need(saved == target if index == 0 else json.loads(saved) == versions, '変数の保存値が不一致です。再配置せず--finishで状態を確認してください。')
        need(strict_configuration_guards(api, token, commit, data, baseline, installed=installed) == versions, '更新後の保護設定が変わりました。')
        need(variable_value(api, token, REPOSITORY_VARIABLE, paths[0][1]) == commit
             and json.loads(variable_value(api, token, STAGING_VARIABLE, paths[1][1])) == versions, '最終保存値が不一致です。')
        report.update(stage='complete', variablesVerified=True, ruleVersions=versions, success=True)
    except Exception as error:
        report['stopped'] = True
        report['reason'] = str(error) if isinstance(error, Stop) else '設定確認で停止しました。認証値・元応答は表示しません。'
    return report



CONTROL_RULE = REPO + '/rulesets/25676153'
APP_BYPASS = [{'actor_id': APP, 'actor_type': 'Integration', 'bypass_mode': 'always'}]


def maintenance_permitted(method, path, body):
    if method == 'PUT':
        return path == CONTROL_RULE and isinstance(body, dict) and set(body) == {'bypass_actors'} and body['bypass_actors'] in ([], APP_BYPASS)
    return configuration_permitted(method, path, body)


def maintenance_request(method, path, auth=None, body=None):
    return request(method, path, auth, body, policy=maintenance_permitted)


def rule_core(rule):
    need(rule.get('name') == 'ci-control-human-managed' and rule.get('target') == 'branch'
         and rule.get('enforcement') == 'active'
         and rule.get('conditions', {}).get('ref_name', {}).get('include') == ['refs/heads/ci-control']
         and all(x in ('refs/heads/main', 'refs/heads/develop') for x in rule['conditions']['ref_name'].get('exclude', []))
         and {'creation', 'update', 'deletion', 'non_fast_forward'} <= {x['type'] for x in rule.get('rules', [])},
         '保守対象のci-control保護が一致しません。')
    # Preserve and compare every configurable field except the temporary exception.
    return json.loads(json.dumps({k: rule.get(k) for k in ('name', 'target', 'enforcement', 'conditions', 'rules')}))


def change_bypass(api, token, snapshot, actors):
    need(actors in ([], APP_BYPASS), '対象外のbypassを拒否しました。')
    need(snapshot.get('bypass_actors') == ([] if actors else APP_BYPASS), 'bypassの変更前状態が不一致です。')
    core = rule_core(snapshot)
    need(ok(api, 'GET', CONTROL_RULE, token) == snapshot, '変更直前に保護設定が変わりました。上書きしません。')
    ok(api, 'PUT', CONTROL_RULE, token, {'bypass_actors': actors})
    current = ok(api, 'GET', CONTROL_RULE, token)
    need(rule_core(current) == core and current.get('bypass_actors') == actors
         and bool(ISO_VERSION.fullmatch(current.get('updated_at', ''))), 'bypassの保存結果を確認できません。')
    return current


def clear_maintenance_bypass(api, token, core):
    current = ok(api, 'GET', CONTROL_RULE, token)
    need(rule_core(current) == core, '保守中に別の保護設定変更を検出しました。上書きせず管理者確認が必要です。')
    need(current.get('bypass_actors') in ([], APP_BYPASS), '第三者のbypassを検出しました。上書きせず管理者確認が必要です。')
    if current['bypass_actors']:
        current = change_bypass(api, token, current, [])
    need(current.get('bypass_actors') == [], 'bypassが空であることを確認できません。')
    return current


def maintain(data, baseline, jwt, token, *, api=maintenance_request, app_api=request, checkpoint=lambda state: None):
    report = {'mode': 'human-control-maintenance', 'stage': 'strict-preflight', 'success': False,
              'bypassAdded': False, 'bypassRemoved': False, 'variablesVerified': False,
              'credentialSaved': False, 'mainRefWriteRequested': False, 'developRefWriteRequested': False,
              'workflowStarted': False, 'deploymentRequested': False}
    core, attempted, installation = None, False, None
    try:
        guards(api, baseline, False, token, require_bypass_list=True)
        before = ok(api, 'GET', CONTROL_RULE, token)
        core = rule_core(before)
        need(before.get('updated_at') == STRICT_RULE_VERSION and before.get('bypass_actors') == [], '開始前のstrict条件が変わりました。')
        need(variable_value(api, token, REPOSITORY_VARIABLE, 'PULBASE_CONTROL_EVIDENCE_SHA') == BASE
             and json.loads(variable_value(api, token, STAGING_VARIABLE, 'PULBASE_CONTROL_RULE_VERSIONS')) == {
                 'ciControl': STRICT_RULE_VERSION, 'main': MAIN_RULE_VERSION, 'protectionMode': 'strict'},
             '開始前の2変数が固定値と不一致です。')
        state = {'version': 1, 'bundleDigest': BUNDLE_DIGEST, 'ruleCore': core, 'stage': 'opening-bypass'}
        checkpoint(state)  # Non-secret recovery record MUST exist before the write.
        attempted = True
        report['stage'] = 'add-bypass'
        added = change_bypass(api, token, before, APP_BYPASS)
        report['bypassAdded'] = True
        state.update(stage='applying', bypassVersion=added['updated_at'])
        checkpoint(state)
        guards(api, baseline, True, token, require_bypass_list=True, apply_version=added['updated_at'])
        report['stage'] = 'install'
        installation = apply(data, baseline, jwt, app_api, rule_version=added['updated_at'])
        report['installation'] = installation
        state.update(stage='clearing-bypass', installation=installation)
        checkpoint(state)
        need(installation['success'], '配置が停止しました。bypassを削除してから結果を確認します。')
    except (Exception, KeyboardInterrupt) as error:
        report['stopped'] = True
        report['reason'] = str(error) if isinstance(error, Stop) else '保守を停止しました。認証値・元応答は表示しません。'
    finally:
        # Also covers failed/ambiguous PUT, failed App authentication and Ctrl-C.
        if attempted:
            try:
                clear_maintenance_bypass(api, token, core)
                report['bypassRemoved'] = True
            except (Exception, KeyboardInterrupt):
                report['cleanupRequired'] = True
                report['cleanupMessage'] = 'bypass削除を確認できません。再配置せず--cleanupで復旧してください。通信不能時はGitHub画面でpulbase-releaseだけを削除してください。'
    if report['bypassRemoved']:
        report['stage'] = 'verify-configuration'
        report['configurationStage'] = 'read-installed-ref'
        try:
            current = ok(api, 'GET', REPO + '/git/ref/heads/ci-control', token)['object']['sha']
            installed = current != BASE
            need(not installed or (installation is not None and installation.get('success') is True
                 and current == installation.get('commit')), '配置先を確定できません。再配置せず--cleanupで確認してください。')
            report['configurationStage'] = 'verify-and-update-variables'
            config = configure(current, data, baseline, token, api, installed=installed)
            report['configuration'] = config
            report['variablesVerified'] = config['success']
            report['success'] = bool(installation and installation.get('success') and config['success'] and not report.get('stopped'))
            if report['success']:
                report['stage'] = 'complete'
        except (Exception, KeyboardInterrupt) as error:
            report['configurationRequired'] = True
            report['configurationReason'] = ('配置後の確認がCtrl+Cで中断されました。' if isinstance(error, KeyboardInterrupt)
                                             else str(error) if isinstance(error, Stop)
                                             else '配置後の確認で停止しました。認証値・元応答は表示しません。')
            report['configurationMessage'] = 'strict復帰後の配置・変数を確定できません。再配置せず--cleanupで確認してください。'
    return report


def cleanup_maintenance(data, baseline, token, state, *, api=maintenance_request):
    need(state.get('version') == 1 and state.get('bundleDigest') == BUNDLE_DIGEST
         and isinstance(state.get('ruleCore'), dict), '非秘密の保守記録が不正です。')
    current_rule = clear_maintenance_bypass(api, token, state['ruleCore'])
    current = ok(api, 'GET', REPO + '/git/ref/heads/ci-control', token)['object']['sha']
    result = configure(current, data, baseline, token, api, installed=current != BASE)
    return {'mode': 'human-maintenance-cleanup', 'bypassRemoved': current_rule.get('bypass_actors') == [],
            'configuration': result, 'success': result['success'], 'credentialSaved': False,
            'installationTokenRevocationConfirmed': state.get('installation', {}).get('tokenRevoked') is True,
            'mainRefWriteRequested': False, 'developRefWriteRequested': False,
            'workflowStarted': False, 'deploymentRequested': False}


def maintenance_state_path(archive):
    return archive.with_name(archive.name + '.maintenance.json')


def save_maintenance_state(archive, state):
    target = maintenance_state_path(archive)
    need(not target.is_symlink(), '保守記録のリンクは拒否します。')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=target.parent, delete=False) as output:
            temporary = output.name
            json.dump(state, output, ensure_ascii=False, indent=2)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
        temporary = None
    finally:
        if temporary:
            os.unlink(temporary)


def human_maintenance(archive, data, baseline, cleaning=False):
    need(input('bypass・信頼定義3件・検証回帰1件・2変数の人用保守を実行する場合 ci-control と入力: ') == 'ci-control', '中止しました。')
    token = hidden('管理端末専用のFine-grained token（非表示・保存なし）: ')
    need(token.startswith('github_pat_'), '管理端末専用のFine-grained tokenを使用してください。')
    calls = 0
    def progress_api(method, path, auth=None, body=None):
        nonlocal calls
        calls += 1
        if calls == 1 or calls % 5 == 0:
            print(f'GitHub確認 {calls}件目を実行中です。完了表示までお待ちください。', file=sys.stderr, flush=True)
        return maintenance_request(method, path, auth, body)
    try:
        print('処理中: GitHubの保護設定・配置・2変数を確認しています。通信確認には数分かかる場合があります。', file=sys.stderr, flush=True)
        if cleaning:
            path = maintenance_state_path(archive)
            need(path.is_file() and not path.is_symlink() and path.stat().st_size < 65536, '保守記録がありません。GitHub画面でbypassを確認してください。')
            result = cleanup_maintenance(data, baseline, token, json.loads(path.read_text()), api=progress_api)
        else:
            pem = Path(hidden('人が保管するpulbase-releaseのPEMファイルのパス（非表示）: ')).expanduser().absolute()
            need(pem.is_file() and not pem.is_symlink() and pem.stat().st_size < 16384, '通常の鍵ファイルではありません。')
            result = maintain(data, baseline, sign(pem), token, api=progress_api,
                              checkpoint=lambda state: save_maintenance_state(archive, state))
            if result.get('installation', {}).get('success'):
                save_receipt(archive, result['installation'])
    finally:
        token = None
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    need(result['success'], '保守が完了していません。再配置せず結果をお知らせください。')
    print('完了しました。ツールは終了します。Ctrl+Cは不要です。', file=sys.stderr, flush=True)

def hidden(prompt):
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        return getpass.getpass(prompt)


def receipt_path(archive):
    return archive.with_name(archive.name + '.receipt.json')


def save_receipt(archive, result):
    receipt = {'version': 1, 'bundleDigest': BUNDLE_DIGEST, 'commit': result['commit'],
               'refUpdated': result['refUpdated'], 'tokenRevoked': result['tokenRevoked']}
    target = receipt_path(archive)
    need(not target.is_symlink(), '配置記録のリンクは拒否します。')
    target.write_text(json.dumps(receipt, indent=2) + '\n')
    target.chmod(0o600)


def finish(archive, data, baseline):
    receipt = receipt_path(archive)
    need(receipt.is_file() and not receipt.is_symlink() and receipt.stat().st_size < 2048, '非秘密の配置記録がありません。再配置せずお知らせください。')
    value = json.loads(receipt.read_text())
    need(value.get('version') == 1 and value.get('bundleDigest') == BUNDLE_DIGEST
         and value.get('refUpdated') is True and value.get('tokenRevoked') is True
         and bool(SHA.fullmatch(value.get('commit', ''))), '配置記録が不正です。')
    print('GitHub画面でpulbase-releaseの一時bypassを削除・保存し、再読み込み後も空であることを確認してください。')
    need(input('bypass削除後、2変数を自動更新する場合 strict と入力: ') == 'strict', '設定更新を中止しました。再配置せず--finishで再開できます。')
    token = hidden('管理端末専用のFine-grained token（非表示・保存なし）: ')
    need(token.startswith('github_pat_'), '管理端末専用のFine-grained tokenを使用してください。保存はしません。')
    try:
        result = configure(value['commit'], data, baseline, token)
    finally:
        token = None
    print(json.dumps(result, ensure_ascii=False, indent=2))
    need(result['success'], '2変数の確認が完了していません。再配置せず、この結果だけお知らせください。')


def main():
    need(len(sys.argv) == 3 and sys.argv[1] in ('--plan', '--apply', '--apply-and-configure', '--finish', '--maintain', '--cleanup'),
         '使い方: python3 install-automatic-resume-control.py --plan / --apply / --apply-and-configure / --finish / --maintain / --cleanup 配置ZIP')
    archive = Path(sys.argv[2]).expanduser().absolute()
    data, baseline = bundle(archive)
    if sys.argv[1] == '--plan':
        guards(request, baseline, False)
        print(json.dumps({'mode': 'plan-only', 'parent': BASE, 'replacedFiles': len(data), 'existingFilesPreserved': len(baseline) - len(data), 'privateKeyUsed': False, 'writeRequested': False}, indent=2))
        return
    need(sys.stdin.isatty(), '配置・設定更新は人の管理用ターミナルで実行してください。')
    if sys.argv[1] in ('--maintain', '--cleanup'):
        human_maintenance(archive, data, baseline, cleaning=sys.argv[1] == '--cleanup')
        return
    if sys.argv[1] == '--finish':
        finish(archive, data, baseline)
        return
    guards(request, baseline, True)
    need(input('信頼定義3件と検証回帰1件を更新する場合 ci-control と入力: ') == 'ci-control', '中止しました。')
    pem = Path(hidden('人が保管するpulbase-releaseのPEMファイルのパス（非表示）: ')).expanduser().absolute()
    need(pem.is_file() and not pem.is_symlink() and pem.stat().st_size < 16384, '通常の鍵ファイルではありません。')
    result = apply(data, baseline, sign(pem))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result['success']:
        save_receipt(archive, result)
    need(result['success'], '配置が完了していません。一時例外を削除して結果をお知らせください。')
    if sys.argv[1] == '--apply-and-configure':
        finish(archive, data, baseline)
    else:
        print('一時例外を削除・保存後、同じZIPを--finishで指定すると2変数を自動更新できます。')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('中止しました。一時例外を設定済みなら削除してください。', file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print(str(error) if isinstance(error, Stop) else '配置を停止しました。秘密情報は表示しません。', file=sys.stderr)
        print('設定済みの一時例外は削除し、配置ツールを再実行せず状態をお知らせください。', file=sys.stderr)
        sys.exit(1)
