import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseDocument } from 'yaml';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
// The existing required check remains the final gate, including skipped/cancelled matrix jobs.
export function checkWebWorkflow(web) {
  assert.ok(!JSON.stringify(web).includes('secrets.'));
  assert.deepEqual(web.permissions, {contents: 'read'});
  assert.deepEqual(web.jobs.verify.needs, ['unit', 'ui']);
  assert.equal(web.jobs.verify.if, 'always()');
  assert.deepEqual(web.jobs.ui.strategy.matrix, {project: ['desktop', 'mobile']});
  assert.equal(web.jobs.ui.strategy['fail-fast'], false);
  assert.equal(web.jobs.ui.needs, undefined);
  assert.equal(web.jobs.unit.needs, undefined);
  for (const job of Object.values(web.jobs)) {
    assert.equal(job.environment, undefined);
    assert.equal(job['continue-on-error'], undefined);
    for (const step of job.steps ?? []) {
      assert.equal(step['continue-on-error'], undefined);
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
    }
  }
  const unit = web.jobs.unit.steps;
  assert.ok(unit.some(s => s.run === 'npm test'));
  assert.ok(unit.some(s => s.run?.includes('for iteration in 1 2 3')));
  const ui = web.jobs.ui.steps.find(s => s.run?.includes('test --config ci/ui-local.config.mjs'));
  assert.equal(ui.run, 'node ci/node_modules/@playwright/test/cli.js test --config ci/ui-local.config.mjs --project=${{ matrix.project }} --reporter=list,blob');
  const steps = web.jobs.verify.steps;
  const gate = steps.findIndex(s => s.env?.UNIT_RESULT);
  assert.ok(gate > 0);
  assert.equal(steps[gate].if, 'always()');
  assert.deepEqual(steps[gate].env, {UNIT_RESULT: '${{ needs.unit.result }}', UI_RESULT: '${{ needs.ui.result }}'});
  assert.equal(steps[gate].run, 'test "$UNIT_RESULT" = success && test "$UI_RESULT" = success');
  const build = steps.findIndex(s => s.run === 'npm run build:${PULBASE_TARGET_ENVIRONMENT}');
  const pack = steps.findIndex(s => s.run === 'node ci/staging-artifact.mjs');
  assert.ok(build > gate && pack > build);
  assert.equal(steps[build].if, undefined);
  assert.equal(steps[pack].if, "env.PULBASE_TARGET_ENVIRONMENT == 'staging'");
  assert.ok(steps.some(s => s.with?.name === 'ui-evidence-${{ github.sha }}-${{ github.run_attempt }}' && s.if === 'always()'));
}
export async function checkWorkflows() {
  const entries = [];
  for (const directory of ['.github/workflows', '.github/workflow-templates']) {
    for (const file of await readdir(resolve(root, directory))) {
      const doc = parseDocument(await readFile(resolve(root, directory, file), 'utf8'), { uniqueKeys: true });
      assert.equal(doc.errors.length, 0, `${file}: ${doc.errors.map(error => error.message).join(', ')}`);
      const data = doc.toJS();
      assert.ok(data.name && data.on && data.jobs, `${file}: missing workflow structure`);
      for (const [name, job] of Object.entries(data.jobs)) {
        assert.ok(job['timeout-minutes'], `${file}/${name}: missing timeout`);
        for (const need of [job.needs ?? []].flat()) assert.ok(data.jobs[need], `${file}: unknown dependency ${need}`);
        const steps = job.steps ?? [];
        const codex = steps.findIndex(step => step.uses?.startsWith('openai/codex-action@'));
        if (codex >= 0) {
          assert.equal(codex, steps.length - 1, `${file}: Codex must be the final step`);
          assert.equal(steps[codex].with['safety-strategy'], 'drop-sudo');
          assert.equal(steps.find(step => step.uses?.startsWith('actions/checkout@')).with['persist-credentials'], false);
        }
      }
      entries.push({ file, data });
    }
  }
  const issue = entries.find(item => item.file === 'codex-issue.yml').data;
  assert.match(issue.jobs.intake.if, /PULBASE_CODEX_ENABLED/);
  assert.match(issue.jobs.intake.if, /実装:自動/);
  assert.ok(issue['run-name'].includes('github.event.issue.number'));
  assert.equal(issue.jobs.implement.if, "needs.intake.outputs.eligible == 'true'");
  assert.ok(issue.jobs.publish.steps.some(step => step.run === undefined && step.with?.script?.includes('assertAutomaticAssignment')));
  assert.ok(!JSON.stringify(issue).includes('refs/heads/main'));
  const implementation = issue.jobs.implement.steps.find(step => step.uses?.startsWith('openai/codex-action@'));
  assert.equal(implementation.with['allow-bots'], "${{ needs.intake.outputs.repair == 'true' && github.actor == 'github-actions[bot]' }}");
  assert.equal(implementation.with['allow-users'], undefined);
  assert.equal(implementation.with['allow-bot-users'], undefined);
  const pr = entries.find(item => item.file === 'codex-pr.yml').data;
  assert.deepEqual(pr.on.pull_request.branches, ['develop']);
  for (const name of ['staging', 'regression', 'merge', 'report']) assert.equal(pr.jobs[name], undefined);
  assert.equal(pr.concurrency, undefined);
  for (const job of Object.values(pr.jobs)) {
    assert.ok(!JSON.stringify(job).includes('CLOUDFLARE_API_TOKEN'));
    for (const step of job.steps ?? []) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
  }
  const review = pr.jobs.review.steps.find(step => step.uses?.startsWith('openai/codex-action@'));
  assert.equal(review.with['codex-version'], '0.164.0');
  const develop = entries.find(item => item.file === 'develop-staging.yml').data;
  assert.deepEqual(Object.keys(develop.on), ['workflow_dispatch']);
  assert.deepEqual(develop.permissions, {});
  assert.ok(!JSON.stringify(develop).includes('secrets.'));
  assert.ok(develop.jobs.retired.steps.some(step => step.run?.includes('exit 1')));
  const web = entries.find(item => item.file === 'web-checks.yml').data;
  checkWebWorkflow(web);

  const repair=entries.find(item=>item.file==='automatic-repair.yml').data;
  assert.deepEqual(repair.permissions,{contents:'read',actions:'write',issues:'write'});
  assert.equal(repair.concurrency.group,'automatic-repair-repository');
  assert.equal(repair.concurrency['cancel-in-progress'],false);
  assert.equal(repair.jobs.coordinate.environment,undefined);
  assert.ok(!JSON.stringify(repair).includes('secrets.'));
  assert.equal(repair.jobs.coordinate.steps.find(s=>s.uses?.startsWith('actions/checkout@')).with.ref,'${{ github.sha }}');
  assert.ok(JSON.stringify(issue.jobs.implement).includes('trusted-repair/repair-workspace.mjs'));
  assert.ok(JSON.stringify(issue.jobs.publish).includes('REPAIR_MODE'));
  assert.ok(!issue.jobs.intake.if.includes("github.event.label.name == '実装:再開'"));

  const release = entries.find(item => item.file === 'production-release.yml.disabled').data;
  assert.match(release.jobs.prepare.if, /PULBASE_PRODUCTION_ENABLED/);
  assert.equal(release.jobs.prepare.environment, 'release-preflight');
  assert.equal(release.jobs.release.environment, 'production');
  assert.equal(release.jobs.announce.environment, undefined);
  assert.equal(release.jobs.announce.if, "needs.release.result == 'success'");
  const announcement = JSON.stringify(release.jobs.announce);
  assert.ok(!/secrets\.|create-github-app-token|PULBASE_X_ENABLED|announce-x/.test(announcement));
  assert.ok(announcement.includes('node ci/release-announcement.mjs'));
  assert.ok(announcement.includes('actions/upload-artifact@'));
  assert.ok(release.jobs.announce.needs.includes('release'));
  assert.ok(!entries.filter(item => !item.file.endsWith('.disabled')).some(item => JSON.stringify(item.data).includes('npm run deploy -- production')));
  return entries.length;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Validated ${await checkWorkflows()} workflows/templates`);
}
