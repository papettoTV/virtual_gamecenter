import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseDocument } from 'yaml';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
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
  assert.ok(!JSON.stringify(web).includes('secrets.'));
  assert.ok(JSON.stringify(web.jobs.verify).includes('staging-artifact.mjs'));

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
