import { appendFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export const SOURCE = 'papettoTV/virtual_gamecenter';
const sha = /^[a-f0-9]{40}$/;
export function executionContext(env = process.env) {
  const value = { repository: env.GITHUB_REPOSITORY, ref: env.GITHUB_REF,
    event: env.GITHUB_EVENT_NAME, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
    controlSha: env.GITHUB_SHA, environment: 'staging' };
  if (value.repository !== SOURCE || value.ref !== 'refs/heads/ci-control'
    || value.event !== 'workflow_dispatch' || !/^[1-9][0-9]*$/.test(value.runId ?? '')
    || value.attempt !== '1' || !sha.test(value.controlSha ?? '')) {
    throw Error('ci-controlの初回workflow_dispatch実行だけを許可します。');
  }
  return value;
}
export function readApi(token, request = fetch) {
  if (!token) throw Error('GitHubの一時読取認証がありません。');
  return async path => {
    if (!/^(?:environments\/staging(?:\/deployment-branch-policies\?per_page=100)?|rulesets(?:\/[1-9][0-9]*|\?per_page=100)|git\/ref\/heads\/(?:ci-control|main))$/.test(path)) {
      throw Error('対象外APIを拒否しました。');
    }
    try {
      const response = await request(`https://api.github.com/repos/${SOURCE}/${path}`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) { await response.body?.cancel(); throw Error(); }
      return await response.json();
    } catch { throw Error('GitHubの保護設定を読み取れません。応答・認証値は表示していません。'); }
  };
}
export async function verifyProtection(api, execution, { requireSnapshot = true, ruleVersions } = {}) {
  const environment = await api('environments/staging');
  const reviewers = environment.protection_rules?.find(rule => rule.type === 'required_reviewers')?.reviewers;
  if (environment.can_admins_bypass !== false || environment.deployment_branch_policy?.custom_branch_policies !== true
    || environment.deployment_branch_policy?.protected_branches !== false || !Array.isArray(reviewers)
    || reviewers.length !== 1 || reviewers[0].type !== 'User' || reviewers[0].reviewer?.login !== 'papettoTV') {
    throw Error('stagingの人の承認と管理者bypass禁止を確認できません。');
  }
  const branches = await api('environments/staging/deployment-branch-policies?per_page=100');
  if (branches.total_count !== 1 || branches.branch_policies?.length !== 1
    || branches.branch_policies[0].name !== 'ci-control' || branches.branch_policies[0].type !== 'branch') {
    throw Error('stagingの許可対象がBranch型ci-controlだけではありません。');
  }
  const rules = await api('rulesets?per_page=100');
  // A full first page is ambiguous: never assume later rules do not exist.
  if (!Array.isArray(rules) || rules.length >= 100) throw Error('ルールセット一覧が不完全です。');
  const matching = rules.filter(rule => rule.name === 'ci-control-human-managed');
  if (matching.length !== 1 || !Number.isSafeInteger(matching[0].id) || matching[0].id < 1) throw Error('ci-controlルールが一意ではありません。');
  const rule = await api(`rulesets/${matching[0].id}`);
  const include = rule.conditions?.ref_name?.include, exclude = rule.conditions?.ref_name?.exclude;
  if (rule.target !== 'branch' || rule.enforcement !== 'active' || ('bypass_actors' in rule && rule.bypass_actors?.length !== 0)
    || include?.length !== 1 || include[0] !== 'refs/heads/ci-control' || !Array.isArray(exclude)
    || exclude.some(ref => !['refs/heads/main', 'refs/heads/develop'].includes(ref))
    || !['creation', 'update', 'deletion', 'non_fast_forward'].every(type => rule.rules?.some(item => item.type === type))
    || rule.rules.some(item => item.type === 'update' && item.parameters?.update_allows_fetch_and_merge === true)) {
    throw Error('ci-controlの変更禁止と例外なしを確認できません。');
  }
  const mainRules = rules.filter(item => item.name === 'main-release-app-only');
  if (mainRules.length !== 1 || !Number.isSafeInteger(mainRules[0].id) || mainRules[0].id < 1) throw Error('mainの更新禁止ルールを確認できません。');
  const mainRule = await api(`rulesets/${mainRules[0].id}`);
  if (mainRule.enforcement !== 'active' || mainRule.target !== 'branch' || ('bypass_actors' in mainRule && mainRule.bypass_actors?.length !== 0)
    || mainRule.conditions?.ref_name?.include?.length !== 1 || mainRule.conditions.ref_name.include[0] !== 'refs/heads/main'
    || mainRule.conditions.ref_name.exclude?.length !== 0 || !mainRule.rules?.some(item => item.type === 'update')) {
    throw Error('mainの更新禁止と例外なしを確認できません。');
  }
  // GITHUB_TOKEN/public reads can omit bypass_actors. The human-managed staging
  // variable pins versions checked with the full lists; missing data is not [].
  let bypassSnapshotVerified = false;
  if (requireSnapshot) {
    let versions;
    try { versions = JSON.parse(ruleVersions); } catch { throw Error('人が確認した保護設定版が未登録です。'); }
    if (Object.keys(versions ?? {}).sort().join(',') !== 'ciControl,main'
      || !/^20\d\d-\d\d-\d\dT[0-9:.]+Z$/.test(versions.ciControl ?? '')
      || !/^20\d\d-\d\d-\d\dT[0-9:.]+Z$/.test(versions.main ?? '')
      || rule.updated_at !== versions.ciControl || mainRule.updated_at !== versions.main) {
      throw Error('例外一覧を人が確認した設定版から変更されています。');
    }
    bypassSnapshotVerified = true;
  }
  if ((await api('git/ref/heads/ci-control')).object?.sha !== execution.controlSha) throw Error('制御ブランチが実行中のSHAから変わりました。');
  const mainSha = (await api('git/ref/heads/main')).object?.sha;
  if (mainSha !== '73cb5d9267c56f06f9f1150327ec6b8b3caa2bb9') throw Error('mainが今回の準備開始時のSHAから変わりました。公開せず停止します。');
  return { version: 1, mode: 'rehearsal-only', checkedAt: new Date().toISOString(), execution,
    preflightReady: true, protectionVerified: bypassSnapshotVerified, bypassSnapshotVerified,
    publicRuleVersions: { ciControl: rule.updated_at, main: mainRule.updated_at },
    mainSha, deploymentRequested: false, secretsRegistered: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw Error('任意の対象指定は許可しません。');
    const execution = executionContext();
    const report = await verifyProtection(readApi(process.env.GH_TOKEN), execution, { requireSnapshot: false });
    await writeFile('control-protection.json', JSON.stringify(report, null, 2), { mode: 0o600 });
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## 公開なしの予行試験\n制御SHA: ${execution.controlSha}\n\n次のstaging承認は制御の模擬試験だけを対象とします。PRのマージ・Worker/Pages公開は行いません。\n`);
    console.log('ci-controlとstagingの保護設定を確認しました。鍵・公開APIは使用していません。');
  } catch (error) { console.error(error instanceof Error ? error.message : '保護設定を確認できません。'); process.exitCode = 1; }
}
