#!/usr/bin/env python3
"""Human-terminal-only replacement of three pinned trust files. No workflow changes."""
import base64
import getpass
import hashlib
import io
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
BASE = '1919c95b933d9b820b6db7bc54572020923c9849'
MAIN = '73cb5d9267c56f06f9f1150327ec6b8b3caa2bb9'
APP = 5405029
BUNDLE_DIGEST = 'PACKAGED_BUNDLE_DIGEST'
APPLY_RULE_VERSION = None  # Pin only after the sole human-managed App bypass is verified.
STRICT_RULE_VERSION = '2026-10-31T01:19:50.549Z'
MAIN_RULE_VERSION = '2026-10-21T20:32:35.191Z'
MANIFEST = 'automatic-resume-installation.json'
FILES = {'ci/control/review-trust.mjs', 'ci/control/review-trust.json', 'ci/production-candidate/policy.json'}
SHA = re.compile(r'^[a-f0-9]{40}$')
MESSAGE = 'ci: 自動Issue再開の信頼定義3件だけを更新（公開なし）'


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


def request(method, path, auth=None, body=None):
    need(permitted(method, path, body), '対象外のAPI操作を拒否しました。')
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


def ok(api, method, path, auth=None, body=None):
    code, value = api(method, path, auth, body)
    need(code in (200, 201, 204), 'GitHub API確認に失敗しました（HTTP ' + str(code) + '）。再試行せず状態を確認してください。')
    return value


def tree_matches(tree, expected):
    need(tree.get('truncated') is False and isinstance(tree.get('tree'), list), 'tree一覧が不完全です。')
    entries = tree['tree']
    leaves = [x for x in entries if x.get('type') != 'tree']
    need(len(leaves) == len(expected) and all(x.get('type') == 'blob' and x.get('mode') == '100644' for x in leaves)
         and {x['path']: x['sha'] for x in leaves} == expected, '既存ファイルの変更・削除・想定外ファイルを検出しました。')


def guards(api, baseline, applying, token=None):
    version = APPLY_RULE_VERSION if applying else STRICT_RULE_VERSION
    need(isinstance(version, str), '人が確認した一時例外の設定版が未固定です。配置は無効です。')
    rule = ok(api, 'GET', REPO + '/rulesets/25676153', token)
    expected = [{'actor_id': APP, 'actor_type': 'Integration', 'bypass_mode': 'always'}] if applying else []
    # Public/App reads may omit the bypass list. The reviewed exact version is pinned
    # only after the limited owner read has independently checked the complete list.
    need(rule.get('target') == 'branch' and rule.get('enforcement') == 'active' and rule.get('updated_at') == version
         and ('bypass_actors' not in rule or rule['bypass_actors'] == expected)
         and rule.get('conditions', {}).get('ref_name', {}).get('include') == ['refs/heads/ci-control']
         and all(x in ('refs/heads/main', 'refs/heads/develop') for x in rule['conditions']['ref_name'].get('exclude', []))
         and {'creation', 'update', 'deletion', 'non_fast_forward'} <= {x['type'] for x in rule.get('rules', [])}, 'ci-controlの保護・設定版が不一致です。')
    main = ok(api, 'GET', REPO + '/rulesets/25520943', token)
    need(main.get('target') == 'branch' and main.get('enforcement') == 'active' and main.get('updated_at') == MAIN_RULE_VERSION
         and ('bypass_actors' not in main or main['bypass_actors'] == [])
         and main.get('conditions', {}).get('ref_name') == {'include': ['refs/heads/main'], 'exclude': []}
         and any(x['type'] == 'update' for x in main.get('rules', [])), 'mainの更新禁止が不一致です。')
    need(ok(api, 'GET', REPO + '/git/ref/heads/main', token)['object']['sha'] == MAIN, 'mainが準備時のSHAから変わりました。')
    need(ok(api, 'GET', REPO + '/git/ref/heads/ci-control', token)['object']['sha'] == BASE, 'ci-controlが想定の親SHAと不一致です。')
    tree_matches(ok(api, 'GET', REPO + '/git/trees/' + BASE + '?recursive=1', token), baseline)
    env = ok(api, 'GET', REPO + '/environments/staging', token)
    reviewers = [x for x in env.get('protection_rules', []) if x.get('type') == 'required_reviewers']
    need(env.get('can_admins_bypass') is False and env.get('deployment_branch_policy') == {'protected_branches': False, 'custom_branch_policies': True}
         and len(reviewers) == 1 and len(reviewers[0].get('reviewers', [])) == 1
         and reviewers[0]['reviewers'][0].get('type') == 'User' and reviewers[0]['reviewers'][0]['reviewer']['login'] == 'papettoTV', 'stagingの承認条件が不一致です。')
    branches = ok(api, 'GET', REPO + '/environments/staging/deployment-branch-policies?per_page=100', token)
    need(branches.get('total_count') == 1 and len(branches.get('branch_policies', [])) == 1
         and branches['branch_policies'][0]['name'] == 'ci-control' and branches['branch_policies'][0]['type'] == 'branch', 'stagingがci-control限定ではありません。')


def apply(data, baseline, jwt, api=request):
    token = None
    report = {'mode': 'automatic-resume-control-update-only', 'stage': 'preflight', 'commit': None, 'refUpdated': False,
              'tokenRevoked': None, 'mainRefWriteRequested': False, 'developRefWriteRequested': False,
              'workflowStarted': False, 'workflowChanged': False, 'deploymentRequested': False}
    try:
        guards(api, baseline, True)
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
        guards(api, baseline, True, token)
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


def main():
    need(len(sys.argv) == 3 and sys.argv[1] in ('--plan', '--apply'), '使い方: python3 install-automatic-resume-control.py --plan または --apply 配置ZIP')
    data, baseline = bundle(Path(sys.argv[2]).expanduser().absolute())
    applying = sys.argv[1] == '--apply'
    guards(request, baseline, applying)
    if not applying:
        print(json.dumps({'mode': 'plan-only', 'parent': BASE, 'replacedFiles': len(data), 'existingFilesPreserved': len(baseline) - len(data), 'privateKeyUsed': False, 'writeRequested': False}, indent=2))
        return
    need(sys.stdin.isatty(), '配置は人の管理用ターミナルで実行してください。')
    need(input('信頼定義3件だけを更新する場合 ci-control と入力: ') == 'ci-control', '中止しました。')
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        pem = Path(getpass.getpass('人が保管するpulbase-releaseのPEMファイルのパス（非表示）: ')).expanduser().absolute()
    need(pem.is_file() and not pem.is_symlink() and pem.stat().st_size < 16384, '通常の鍵ファイルではありません。')
    result = apply(data, baseline, sign(pem))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print('成功・失敗にかかわらず一時例外を削除してください。workflow起動・変数変更・再実行はまだ行わないでください。')
    if not result['success']:
        sys.exit(1)


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
