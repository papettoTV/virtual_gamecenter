#!/usr/bin/env python3
"""Human-only fast-forward ci-control update. No main/develop writes or deployments."""
from datetime import datetime
import base64
import getpass
import hashlib
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
APP = 5405029
BUNDLE_SHA = '6e360fd73542100995a4e25779bf384bfb503a9a28824774a06007c6c1d42f5d'
PREVIOUS_SHA = 'caeaee4f3474bff96a0449f20e434df52765bc98'
MAIN_SHA = '73cb5d9267c56f06f9f1150327ec6b8b3caa2bb9'
# These metadata-only versions were read with the limited owner PAT and its full
# bypass list checked. Apply stays disabled until the human adds the sole App
# bypass and the resulting version is independently read and pinned here.
PLAN_CONTROL_VERSION = '2026-10-25T13:07:28.889Z'
APPLY_CONTROL_VERSION = None
MAIN_RULE_VERSION = '2026-10-21T20:32:35.191Z'
SHA = re.compile(r'^[a-f0-9]{40}$')
FILES = {'ci/control/toolchain/prepare-browser-sandbox.mjs', 'ci/tests/fixed-tool-diagnostics.test.mjs', 'ci/control/fixed-process.mjs', 'ci/control/fixed-staging-operations.mjs', 'ci/tests/fixed-staging-operations.test.mjs', 'ci/control/toolchain/package.json', 'ci/tests/review-trust.test.mjs', 'ci/control/develop-merge.mjs', 'ci/tests/staging-runtime.test.mjs', 'ci/tests/postmerge-staging.test.mjs', 'ci/control/staging-publication.mjs', '.github/workflows/postmerge-staging.yml', 'ci/control/toolchain/staging-browser.config.mjs', 'ci/tests/control-protection.test.mjs', 'ci/control/staging-target.json', 'ci/control/review-trust.mjs', 'ci/control/postmerge-staging.mjs', 'ci/control/review-trust.json', 'ci/control/toolchain/package-lock.json', 'ci/control/postmerge-runner.mjs', 'ci/control/protection-check.mjs', 'README.md', 'ci/control/toolchain/browser/regression.spec.mjs', 'ci/control/staging-gateway.mjs', 'ci/control/candidate-evidence.mjs', 'ci/control/premerge-decision.mjs', 'ci/control/staging-regression.mjs'}


class Stop(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def permitted(method, path, body):
    reads = {REPO, '/app', '/installation/repositories', REPO + '/installation', REPO + '/rulesets/25676153',
             REPO + '/rulesets/25520943', REPO + '/environments/staging',
             REPO + '/environments/staging/deployment-branch-policies?per_page=100'}
    if method == 'GET':
        return path in reads or bool(re.fullmatch(re.escape(REPO) + r'/git/ref/heads/(main|develop|ci-control)', path)) or bool(
            re.fullmatch(re.escape(REPO) + r'/git/trees/[a-f0-9]{40}\?recursive=1', path))
    if method == 'PATCH':
        return path == REPO + '/git/refs/heads/ci-control' and isinstance(body, dict) and set(body) == {'sha', 'force'} and bool(SHA.fullmatch(body.get('sha', ''))) and body['force'] is False
    if method == 'DELETE':
        return path == '/installation/token' and body is None
    if method != 'POST' or not isinstance(body, dict):
        return False
    if re.fullmatch(r'/app/installations/[1-9][0-9]*/access_tokens', path):
        return body == {'repositories': ['virtual_gamecenter'], 'permissions': {'contents': 'write', 'workflows': 'write'}}
    if path == REPO + '/git/trees':
        entries = body.get('tree')
        return set(body) == {'tree'} and isinstance(entries, list) and len(entries) == len(FILES) + 1 and all(
            set(item) == {'path', 'mode', 'type', 'content'} and item['path'] in FILES | {'bundle-manifest.json'}
            and item['mode'] == '100644' and item['type'] == 'blob' and isinstance(item['content'], str)
            for item in entries) and len({item['path'] for item in entries}) == len(FILES) + 1
    if path == REPO + '/git/commits':
        return set(body) == {'message', 'tree', 'parents'} and body['message'] == 'chore: Pages共有設定保持とsandbox起動の修正を配置（公開なし）' and bool(
            SHA.fullmatch(body.get('tree', ''))) and body.get('parents') == [PREVIOUS_SHA]
    return False


def request(method, path, auth=None, body=None):
    if not permitted(method, path, body):
        raise Stop('対象外のAPI操作を拒否しました。')
    headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'}
    if auth:
        headers['Authorization'] = 'Bearer ' + auth
    req = urllib.request.Request('https://api.github.com' + path, method=method, headers=headers,
        data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None)
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=20) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise Stop('応答のサイズ制限を超えました。')
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        code = error.code
        limited = error.headers.get('X-RateLimit-Remaining') == '0'
        reset = error.headers.get('X-RateLimit-Reset', '')
        error.close()
        return code, {'safeFailure': {'rateLimited': limited, 'rateResetEpoch': reset if reset.isdigit() else None}}
    except Exception:
        raise Stop('GitHubへの接続に失敗しました。応答・認証値は表示していません。') from None


def ok(api, method, path, auth=None, body=None):
    code, data = api(method, path, auth, body)
    if code not in (200, 201, 204):
        failure = data.get('safeFailure', {}) if isinstance(data, dict) else {}
        reason = '認証なし/認証付きAPIの呼出枠を使い切りました。' if failure.get('rateLimited') else 'API権限または接続条件を確認してください。'
        reset = failure.get('rateResetEpoch')
        raise Stop('GitHub APIの確認に失敗しました（HTTP ' + str(code) + '、' + method + ' ' + path + '）。' + reason + (' rateResetEpoch=' + reset if reset else ''))
    return data


def bundle(path):
    if not stat.S_ISREG(path.lstat().st_mode) or path.is_symlink() or path.stat().st_size > 1024 * 1024:
        raise Stop('通常の配置ZIPではありません。')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != BUNDLE_SHA:
        raise Stop('レビュー対象のZIPとSHA-256が一致しません。')
    with zipfile.ZipFile(path) as archive:
        if len(archive.infolist()) != len(FILES) + 1 or set(archive.namelist()) != FILES | {'bundle-manifest.json'}:
            raise Stop('配置ファイルの集合が一致しません。')
        entries = {name: archive.read(name) for name in archive.namelist()}
    manifest = json.loads(entries['bundle-manifest.json'])
    if (manifest.get('version') != 9 or manifest.get('mode') != 'postmerge-staging-live' or manifest.get('mergeEnabled') is not False or manifest.get('regressionCount') != 1 or manifest.get('liveTransportConnected') is not True or manifest.get('previousControlSha') != PREVIOUS_SHA or manifest.get('deploymentEnabled') is not True
        or manifest.get('repository') != 'papettoTV/virtual_gamecenter' or manifest.get('branch') != 'ci-control'
        or set(manifest.get('files', {})) != FILES):
        raise Stop('検証用の実公開制御manifestではありません。')
    for name in FILES:
        if hashlib.sha256(entries[name]).hexdigest() != manifest['files'][name]:
            raise Stop('配置ファイルのハッシュが一致しません。')
    return entries


def same_version(actual, expected):
    try:
        a, b = (datetime.fromisoformat(x.replace('Z', '+00:00')) for x in (actual, expected))
        return a.tzinfo is not None and b.tzinfo is not None and a == b
    except (TypeError, ValueError, AttributeError):
        return False


def guards(api, applying, auth=None):
    rule = ok(api, 'GET', REPO + '/rulesets/25676153', auth)
    expected_bypass = [{'actor_id': APP, 'actor_type': 'Integration', 'bypass_mode': 'always'}] if applying else []
    refs = rule.get('conditions', {}).get('ref_name', {})
    expected_version = APPLY_CONTROL_VERSION if applying else PLAN_CONTROL_VERSION
    if not expected_version:
        raise Stop('配置用例外の設定版は未確認です。まだ配置を実行できません。')
    if (rule.get('target') != 'branch' or rule.get('enforcement') != 'active' or rule.get('name') != 'ci-control-human-managed'
        or not same_version(rule.get('updated_at'), expected_version)
        or ('bypass_actors' in rule and rule['bypass_actors'] != expected_bypass) or refs.get('include') != ['refs/heads/ci-control']
        or any(ref not in ('refs/heads/main', 'refs/heads/develop') for ref in refs.get('exclude', []))
        or not {'creation', 'update', 'deletion', 'non_fast_forward'}.issubset({item['type'] for item in rule.get('rules', [])})
        or any(item.get('parameters', {}).get('update_allows_fetch_and_merge') is True for item in rule.get('rules', []))):
        raise Stop('ci-controlの保護・配置用例外が想定と一致しません。')
    main = ok(api, 'GET', REPO + '/rulesets/25520943', auth)
    if (main.get('target') != 'branch' or main.get('enforcement') != 'active'
        or ('bypass_actors' in main and main['bypass_actors'] != [])
        or main.get('conditions', {}).get('ref_name') != {'include': ['refs/heads/main'], 'exclude': []}
        or not any(item['type'] == 'update' for item in main.get('rules', []))):
        raise Stop('mainの保護が想定と一致しません。')
    if not same_version(main.get('updated_at'), MAIN_RULE_VERSION):
        raise Stop('mainの保護設定版が変わっています。')
    env = ok(api, 'GET', REPO + '/environments/staging', auth)
    reviewers = next((item.get('reviewers') for item in env.get('protection_rules', []) if item['type'] == 'required_reviewers'), None)
    if (env.get('can_admins_bypass') is not False or env.get('deployment_branch_policy') != {'protected_branches': False, 'custom_branch_policies': True}
        or not isinstance(reviewers, list) or len(reviewers) != 1 or reviewers[0].get('type') != 'User'
        or reviewers[0].get('reviewer', {}).get('login') != 'papettoTV'):
        raise Stop('stagingの承認保護が想定と一致しません。')
    branches = ok(api, 'GET', REPO + '/environments/staging/deployment-branch-policies?per_page=100', auth)
    if branches.get('total_count') != 1 or len(branches.get('branch_policies', [])) != 1 or any(
        item.get('name') != 'ci-control' or item.get('type') != 'branch' for item in branches['branch_policies']):
        raise Stop('stagingの対象ブランチが想定と一致しません。')
    current = ok(api, 'GET', REPO + '/git/ref/heads/ci-control', auth)
    if current.get('object', {}).get('sha') != PREVIOUS_SHA:
        raise Stop('ci-controlが確認済みの旧SHAではありません。更新せず停止しました。')
    main_sha = ok(api, 'GET', REPO + '/git/ref/heads/main', auth)['object']['sha']
    develop = ok(api, 'GET', REPO + '/git/ref/heads/develop', auth)['object']['sha']
    if main_sha != MAIN_SHA or not SHA.fullmatch(develop):
        raise Stop('main/developの事前状態を確認できません。')
    return PREVIOUS_SHA


def sign_jwt(pem):
    def b64(raw):
        return base64.urlsafe_b64encode(raw).rstrip(b'=')
    current = int(time.time())
    data = b64(b'{"alg":"RS256","typ":"JWT"}') + b'.' + b64(json.dumps({'iat': current - 60, 'exp': current + 540, 'iss': APP}).encode())
    result = subprocess.run(['/usr/bin/openssl', 'dgst', '-sha256', '-sign', str(pem)], input=data,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
    if result.returncode or not result.stdout:
        raise Stop('人が保管するApp鍵で署名できません。鍵・詳細は表示しません。')
    return (data + b'.' + b64(result.stdout)).decode()


def git_blob(content):
    return hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()


def apply(entries, jwt, api=request):
    token = None
    report = {'mode': 'control-update-only', 'stage': 'preflight', 'commit': None, 'refUpdated': False,
              'tokenRevoked': None, 'mainRefWriteRequested': False, 'developRefWriteRequested': False,
              'workflowStarted': False, 'deploymentRequested': False}
    try:
        parent = guards(api, True)
        app = ok(api, 'GET', '/app', jwt)
        if (app.get('id') != APP or app.get('slug') != 'pulbase-release' or app.get('owner', {}).get('login') != 'papettoTV'
            or any(app.get('permissions', {}).get(name) != 'write' for name in ('contents', 'workflows'))
            or any(app.get('permissions', {}).get(name) == 'write' for name in ('administration', 'environments', 'secrets', 'variables', 'deployments'))):
            raise Stop('人の配置用Appの識別子・権限を確認できません。')
        installation = ok(api, 'GET', REPO + '/installation', jwt)
        if installation.get('app_id') != APP or installation.get('suspended_at') or not isinstance(installation.get('id'), int):
            raise Stop('配置用Appのインストールを確認できません。')
        created = ok(api, 'POST', '/app/installations/' + str(installation['id']) + '/access_tokens', jwt,
            {'repositories': ['virtual_gamecenter'], 'permissions': {'contents': 'write', 'workflows': 'write'}})
        token = created.get('token')
        if (not token or created.get('permissions', {}).get('contents') != 'write' or created['permissions'].get('workflows') != 'write'
            or any(name not in ('contents', 'workflows', 'metadata') for name in created['permissions'])
            or created['permissions'].get('metadata', 'read') != 'read'):
            raise Stop('一時トークンの最小権限を確認できません。')
        repo = ok(api, 'GET', REPO, token)
        if repo.get('full_name') != 'papettoTV/virtual_gamecenter' or repo.get('default_branch') != 'develop' or repo.get('fork'):
            raise Stop('対象リポジトリが想定と一致しません。')
        accessible = ok(api, 'GET', '/installation/repositories', token)
        if (accessible.get('total_count') != 1 or len(accessible.get('repositories', [])) != 1
            or accessible['repositories'][0].get('full_name') != 'papettoTV/virtual_gamecenter'
            or accessible['repositories'][0].get('id') != repo.get('id')):
            raise Stop('一時トークンの対象が1リポジトリに限定されていません。')
        report['stage'] = 'create-tree'
        tree = ok(api, 'POST', REPO + '/git/trees', token, {'tree': [
            {'path': name, 'mode': '100644', 'type': 'blob', 'content': content.decode('utf-8')}
            for name, content in sorted(entries.items())]})
        if not SHA.fullmatch(tree.get('sha', '')):
            raise Stop('作成したtreeの識別子が不正です。')
        observed = ok(api, 'GET', REPO + '/git/trees/' + tree['sha'] + '?recursive=1', token)
        expected = {name: git_blob(content) for name, content in entries.items()}
        blobs = [item for item in observed.get('tree', []) if item.get('type') == 'blob']
        if (observed.get('truncated') is not False or observed.get('sha') != tree['sha'] or len(blobs) != len(expected)
            or {item['path']: item['sha'] for item in blobs} != expected or any(item.get('mode') != '100644' for item in blobs)
            or any(item.get('type') not in ('tree', 'blob') for item in observed.get('tree', []))):
            raise Stop('配置treeのファイル集合・Gitハッシュが一致しません。')
        report['stage'] = 'create-commit'
        commit = ok(api, 'POST', REPO + '/git/commits', token,
            {'message': 'chore: Pages共有設定保持とsandbox起動の修正を配置（公開なし）', 'tree': tree['sha'], 'parents': [parent]})
        if not SHA.fullmatch(commit.get('sha', '')) or commit.get('tree', {}).get('sha') != tree['sha'] or [item.get('sha') for item in commit.get('parents', [])] != [parent]:
            raise Stop('配置commitの親・treeが一致しません。')
        report['commit'] = commit['sha']
        # Re-read all guards immediately before the only branch-updating write.
        report['stage'] = 'recheck-before-update'
        if guards(api, True, token) != parent:
            raise Stop('配置中にci-controlまたは保護設定が変わりました。更新せず停止します。')
        report['stage'] = 'update-ref'
        value = ok(api, 'PATCH', REPO + '/git/refs/heads/ci-control', token, {'sha': commit['sha'], 'force': False})
        if value.get('ref') != 'refs/heads/ci-control' or value.get('object', {}).get('sha') != commit['sha']:
            raise Stop('ブランチ更新結果を確認できません。再実行せず確認が必要です。')
        report['refUpdated'] = True
        report['mainShaAfter'] = ok(api, 'GET', REPO + '/git/ref/heads/main', token)['object']['sha']
        if report['mainShaAfter'] != MAIN_SHA:
            raise Stop('mainの状態が変わりました。手動確認が必要です。')
        if ok(api, 'GET', REPO + '/git/ref/heads/ci-control', token)['object']['sha'] != commit['sha']:
            raise Stop('配置後のci-controlが一致しません。')
        report['stage'] = 'complete'
    except Exception as error:
        # A timed-out update-ref may have succeeded. Never retry or delete it.
        report['stopped'] = True
        report['reason'] = str(error) if isinstance(error, Stop) else '通信・配置の確認に失敗しました。詳細は表示していません。'
        report['refOutcomeUnknown'] = report['stage'] == 'update-ref' and not report['refUpdated']
    finally:
        if token:
            try:
                report['tokenRevoked'] = api('DELETE', '/installation/token', token, None)[0] == 204
            except Exception:
                report['tokenRevoked'] = False
        report['success'] = report['stage'] == 'complete' and report['tokenRevoked'] is True
    return report


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ('--plan', '--apply'):
        raise Stop('使い方: python3 update-postmerge-staging.py --plan または --apply 配置ZIPのパス')
    entries = bundle(Path(sys.argv[2]).expanduser().absolute())
    if sys.argv[1] == '--plan':
        develop = guards(request, False)
        print(json.dumps({'mode': 'plan-only', 'files': len(entries), 'bundleSha256': BUNDLE_SHA,
            'parentControl': develop, 'branch': 'ci-control', 'privateKeyUsed': False, 'writeRequested': False}, ensure_ascii=False, indent=2))
        return
    if not sys.stdin.isatty():
        raise Stop('配置は人の管理用端末から実行してください。')
    # Validate public state before touching the human-held private key.
    guards(request, True)
    print('レビュー済みのstaging実公開制御workflowをci-controlへ早送り配置します。この操作自体はmain/developの更新・公開をしません。')
    if input('実行する場合だけ ci-control と入力: ') != 'ci-control':
        raise Stop('配置を中止しました。')
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        pem = Path(getpass.getpass('人が保管するpulbase-releaseのPEMファイルのパス（非表示）: ')).expanduser().absolute()
    if not stat.S_ISREG(pem.lstat().st_mode) or pem.is_symlink():
        raise Stop('通常のPEMファイルではありません。')
    result = apply(entries, sign_jwt(pem))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print('構築中はpulbase-releaseだけの例外を維持できます。stagingの保護設定版をconstructionで照合してください。最終確認前に例外を削除しstrictへ戻してください。')
    print('成功・失敗に関係なく、workflowの起動・再実行・例外の追加はまだ行わないでください。')
    if not result['success']:
        sys.exit(1)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\n中止しました。一時例外を設定済みなら空へ戻してください。', file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print(str(error) if isinstance(error, Stop) else '安全のため停止しました。鍵・認証値・詳細は表示していません。', file=sys.stderr)
        if '--apply' in sys.argv:
            print('配置を再実行せず、設定済みのci-control一時例外を空へ戻してからCodexへお知らせください。', file=sys.stderr)
        sys.exit(1)
