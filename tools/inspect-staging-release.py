#!/usr/bin/env python3
"""Human terminal only. Fixed staging GETs; no token persistence or response dumps."""
import getpass
import json
import re
import sys
import urllib.error
import urllib.request
import warnings

ACCOUNT = '60e5472a284dc71bbafbbfac8aa2a940'
BASE = 'https://api.cloudflare.com/client/v4'
ROOT = '/accounts/' + ACCOUNT
PATHS = {
    'workerService': ROOT + '/workers/services/pulbase-staging',
    'workerSettings': ROOT + '/workers/scripts/pulbase-staging/settings',
    'workerDeployments': ROOT + '/workers/scripts/pulbase-staging/deployments',
    'workerSecretNames': ROOT + '/workers/scripts/pulbase-staging/secrets',
    'pagesProject': ROOT + '/pages/projects/virtual-gamecenter',
}
REQUIRED = {'BASIC_AUTH_USERNAME', 'BASIC_AUTH_PASSWORD', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CLOUDFLARE_METRICS_TOKEN', 'OPERATOR_ACCOUNT_IDS'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def fetch(name, token, opener=None):
    if name not in PATHS:
        raise ValueError('対象外の読取先です')
    request = urllib.request.Request(BASE + PATHS[name], method='GET', headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json'})
    try:
        with (opener or urllib.request.build_opener(NoRedirect())).open(request, timeout=20) as response:
            status, body = response.status, response.read(2 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as error:
        status = error.code
        body = error.read(2 * 1024 * 1024 + 1)
        error.close()
    except Exception:
        return {'endpoint': name, 'status': None, 'failure': 'connection-error'}
    if len(body) > 2 * 1024 * 1024:
        return {'endpoint': name, 'status': status, 'failure': 'response-too-large'}
    try:
        data = json.loads(body)
        if not isinstance(data, dict):
            raise ValueError()
    except Exception:
        return {'endpoint': name, 'status': status, 'failure': 'invalid-json'}
    report = {'endpoint': name, 'status': status, 'success': data.get('success') is True,
              'errorCodes': [v['code'] for v in data.get('errors', []) if isinstance(v, dict) and type(v.get('code')) is int][:10]}
    result = data.get('result')
    if status == 200 and data.get('success') is True:
        if name == 'workerSecretNames' and isinstance(result, list):
            present = {v.get('name') for v in result if isinstance(v, dict)}
            report['requiredSecretsPresent'] = sorted(REQUIRED & present)
            report['requiredSecretsMissing'] = sorted(REQUIRED - present)
        if name == 'workerService' and isinstance(result, dict):
            source = result.get('default_environment', {}).get('script', {}).get('last_deployed_from')
            report['lastDeployedFrom'] = source if source in ('dash', 'wrangler', 'api') else 'other-or-unknown'
        if name == 'workerDeployments' and isinstance(result, dict):
            versions = []
            for deploy in result.get('deployments', [])[:5]:
                if not isinstance(deploy, dict):
                    continue
                for version in deploy.get('versions', []):
                    value = version.get('version_id') if isinstance(version, dict) else None
                    if isinstance(value, str) and re.fullmatch(r'[a-f0-9-]{36}', value):
                        versions.append(value)
            report['recentVersionIds'] = versions[:10]
        if name == 'pagesProject' and isinstance(result, dict):
            config = (result.get('source') or {}).get('config', {})
            report['expectedProject'] = result.get('name') == 'virtual-gamecenter'
            report['productionBranchIsMain'] = result.get('production_branch') == 'main'
            report['gitAutoDeploymentStopped'] = not result.get('source') or config.get('deployments_enabled') is False or (config.get('preview_deployment_setting') == 'none' and config.get('production_deployments_enabled') is False)
    return report


def main():
    if len(sys.argv) != 1 or not sys.stdin.isatty():
        raise ValueError('管理用端末で引数なしで実行してください')
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        token = getpass.getpass('既存のpulbase-staging-releaseトークン（非表示・保存しません）: ')
    if not token or token != token.strip():
        raise ValueError('空または前後に空白のある入力を拒否しました')
    result = {'mode': 'staging-read-only', 'writeRequested': False, 'tokenSaved': False,
              'checks': [fetch(name, token) for name in PATHS]}
    token = None
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('中止しました。公開・変更はありません。', file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('安全のため停止しました。認証値・応答本文は表示していません。', file=sys.stderr)
        sys.exit(1)
