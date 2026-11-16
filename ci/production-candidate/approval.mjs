// Read-only verification for the protected production job.
const repository = 'papettoTV/virtual_gamecenter';
const reviewer = 'papettoTV';
const environment = 'production';
const sha = /^[a-f0-9]{40}$/;

function ensure(condition, message) {
  if (!condition) throw Error(message);
}

function protectedExecution(context) {
  ensure(context.repository === repository && context.ref === 'refs/heads/ci-control'
    && context.event === 'workflow_dispatch' && context.attempt === '1'
    && /^[1-9][0-9]*$/.test(context.runId) && sha.test(context.controlSha),
  '保護されたci-controlの初回実行だけを許可します。');
}

export async function verifyProductionApproval({ api, context }) {
  protectedExecution(context);
  const runPath = 'actions/runs/' + context.runId;
  const [run, target, branches, approvals, current] = await Promise.all([
    runPath, 'environments/production', 'environments/production/deployment-branch-policies?per_page=100',
    runPath + '/approvals', 'git/ref/heads/ci-control',
  ].map(path => api(path)));
  ensure(String(run.id) === context.runId && run.head_sha === context.controlSha
    && run.head_repository?.full_name === repository && run.head_branch === 'ci-control'
    && run.path === '.github/workflows/production-approved-release.yml'
    && run.event === 'workflow_dispatch' && run.run_attempt === 1 && run.status === 'in_progress'
    && current.object?.sha === context.controlSha, '承認された制御の実行が一致しません。');

  const rules = target.protection_rules;
  const required = Array.isArray(rules) ? rules.filter(rule => rule.type === 'required_reviewers') : [];
  ensure(target.name === environment && target.can_admins_bypass === false
    && target.deployment_branch_policy?.custom_branch_policies === true
    && target.deployment_branch_policy.protected_branches === false
    && required.length === 1 && required[0].reviewers?.length === 1
    && required[0].reviewers[0].type === 'User' && required[0].reviewers[0].reviewer?.login === reviewer
    && branches.total_count === 1 && branches.branch_policies?.length === 1
    && branches.branch_policies[0].type === 'branch' && branches.branch_policies[0].name === 'ci-control',
  'productionの承認・管理者bypass・許可ブランチの設定が一致しません。');

  ensure(Array.isArray(approvals) && approvals.length <= 20, '承認履歴が不正です。');
  const relevant = approvals.filter(record => record.environments?.some(entry => entry.name === environment));
  ensure(relevant.length === 1 && relevant[0].state === 'approved' && relevant[0].user?.login === reviewer
    && relevant[0].environments.length === 1 && relevant[0].environments[0].id === target.id,
  'この実行のproduction承認を確認できません。');
  return { runId: context.runId, controlSha: context.controlSha, environment, approvalCount: 1 };
}
