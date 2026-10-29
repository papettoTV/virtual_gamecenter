import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const repository = 'papettoTV/virtual_gamecenter';
const mainSha = '73cb5d9267c56f06f9f1150327ec6b8b3caa2bb9';
export const auditPaths = Object.freeze([
  'actions/variables/PULBASE_PRODUCTION_ENABLED',
  'git/ref/heads/main',
  'rulesets/25520943', 'rulesets/25520941', 'rulesets/25676153',
  'environments/production',
  'environments/production/deployment-branch-policies?per_page=100',
  'environments/production/secrets?per_page=100',
  'actions/secrets?per_page=100',
  ...['staging', 'codex', 'automation', 'announcement', 'release-preflight'].map(name =>
    `environments/${name}/secrets?per_page=100`),
]);

// Only existing GitHub CLI authentication is used; never read or print its token.
// The endpoint allowlist and explicit GET cannot be selected by command-line input.
export function githubReader(run = execute) {
  return async path => {
    if (!auditPaths.includes(path)) throw Error('監査対象外のAPIを拒否しました。');
    try {
      const { stdout } = await run('gh', ['api', '--method', 'GET', `repos/${repository}/${path}`],
        { timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
      return JSON.parse(stdout);
    } catch {
      throw Error('設定を読み取れません。API応答・認証値は表示していません。');
    }
  };
}

function requireCondition(condition, message) {
  if (!condition) throw Error(message);
}

function protectedBranch(rule, branch, types) {
  requireCondition(rule?.target === 'branch' && rule.enforcement === 'active'
    && Array.isArray(rule.bypass_actors) && rule.bypass_actors.length === 0
    && rule.conditions?.ref_name?.include?.length === 1
    && rule.conditions.ref_name.include[0] === `refs/heads/${branch}`
    && Array.isArray(rule.conditions.ref_name.exclude)
    && rule.conditions.ref_name.exclude.every(ref => branch === 'ci-control'
      && ['refs/heads/main', 'refs/heads/develop'].includes(ref))
    && Array.isArray(rule.rules) && types.every(type => rule.rules.some(item => item.type === type))
    && !rule.rules.some(item => item.type === 'update' && item.parameters?.update_allows_fetch_and_merge === true),
  `${branch}のActive・変更制限・bypassなしを確認できません。`);
}

function secretNames(response) {
  requireCondition(Array.isArray(response?.secrets) && Number.isSafeInteger(response.total_count)
    && response.total_count === response.secrets.length && response.total_count < 100
    && response.secrets.every(item => typeof item.name === 'string'), 'Secret名一覧が不完全です。');
  return response.secrets.map(item => item.name).sort();
}

export async function auditProductionSettings(read) {
  // Sequential reads bound the API load. This is an observation, never an approval receipt.
  const data = {};
  for (const path of auditPaths) data[path] = await read(path);
  requireCondition(data[auditPaths[0]]?.value === 'false', '本番フラグが明示的なfalseではありません。');
  requireCondition(data['git/ref/heads/main']?.object?.sha === mainSha, 'mainが準備開始時のSHAから変わっています。');
  protectedBranch(data['rulesets/25520943'], 'main', ['update']);
  protectedBranch(data['rulesets/25520941'], 'main', ['deletion', 'non_fast_forward', 'required_status_checks']);
  const status = data['rulesets/25520941'].rules.find(item => item.type === 'required_status_checks').parameters;
  requireCondition(status?.strict_required_status_checks_policy === true
    && status.do_not_enforce_on_create === false
    && ['verify', 'Automation control checks'].every(context => status.required_status_checks?.some(
      item => item.context === context && item.integration_id === 15368)), 'mainの必須CIが不足しています。');
  protectedBranch(data['rulesets/25676153'], 'ci-control', ['creation', 'update', 'deletion', 'non_fast_forward']);
  const environment = data['environments/production'];
  const reviewerRules = environment?.protection_rules?.filter(item => item.type === 'required_reviewers');
  requireCondition(environment?.can_admins_bypass === false
    && environment.deployment_branch_policy?.custom_branch_policies === true
    && environment.deployment_branch_policy?.protected_branches === false
    && reviewerRules?.length === 1 && reviewerRules[0].reviewers?.length === 1
    && reviewerRules[0].reviewers[0].type === 'User'
    && reviewerRules[0].reviewers[0].reviewer?.login === 'papettoTV', 'productionの人の承認条件が一致しません。');
  const branches = data['environments/production/deployment-branch-policies?per_page=100'];
  requireCondition(branches?.total_count === 1 && branches.branch_policies?.length === 1
    && branches.branch_policies[0].type === 'branch' && branches.branch_policies[0].name === 'main',
  'productionの許可元がBranch型mainだけではありません。');
  const productionSecrets = secretNames(data['environments/production/secrets?per_page=100']);
  const expected = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'PULBASE_CHECK_PASSWORD',
    'PULBASE_CHECK_USERNAME', 'PULBASE_RELEASE_APP_PRIVATE_KEY'].sort();
  requireCondition(JSON.stringify(productionSecrets) === JSON.stringify(expected),
    '本番Secret名が準備中の5件と一致しません。本番トークンの追加もこの段階では許可しません。');
  const otherSecrets = Object.fromEntries(auditPaths.filter(path => path.includes('secrets?')
    && !path.startsWith('environments/production/')).map(path => [path, secretNames(data[path])]));
  requireCondition(Object.values(otherSecrets).every(names => !names.includes('PULBASE_RELEASE_APP_PRIVATE_KEY')),
    '本番リリース鍵の登録名がproduction以外にあります。');
  requireCondition(otherSecrets['actions/secrets?per_page=100'].length === 0,
    'Repository Secretが追加されています。保管先を再確認してください。');
  return {
    version: 1, mode: 'production-settings-read-only', checkedAt: new Date().toISOString(),
    repository, settingsPassed: true, productionReady: false, mainSha,
    productionEnabled: false, humanApprovalRequired: true, productionBranch: 'main',
    mainBypassCount: 0, controlBypassCount: 0, productionSecretNames: productionSecrets,
    releaseKeyNameOnlyInProduction: true, secretValuesVerified: false,
    writeRequested: false, deploymentRequested: false, workerCreated: false, xPosted: false,
    limitations: ['監査時点の設定名とメタデータだけ。承認・実行許可の証跡として使わない。',
      '別名の鍵・管理用端末・他の認証経路の不存在やSecret値の有効性は証明しない。',
      'Cloudflareの実リソース・Googleの実認証・本番公開可否は判定しない。'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    requireCondition(process.argv.length === 2, '監査に引数は指定できません。');
    const directory = fileURLToPath(new URL('./results/', import.meta.url));
    await mkdir(directory, { recursive: true });
    // A failed new audit must not leave a previous success at this output path.
    await rm(`${directory}production-settings-audit.json`, { force: true });
    const report = await auditProductionSettings(githubReader());
    await writeFile(`${directory}production-settings-audit.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
