import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { checkStagingAccess } from '../staging-preflight.mjs';
const project = { name: 'virtual-gamecenter', production_branch: 'main', source: { config: { preview_deployment_setting: 'all' } } };
test('staging preflight makes only fixed GET requests and reports preview configuration separately', async () => {
  const calls = [];
  const result = await checkStagingAccess('private-token', async (url, options) => {
    calls.push(url);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    return Response.json({ success: true, result: url.endsWith('/script-settings') ? {} : project });
  });
  assert.deepEqual(calls, [
    'https://api.cloudflare.com/client/v4/accounts/60e5472a284dc71bbafbbfac8aa2a940/workers/scripts/pulbase-staging/script-settings',
    'https://api.cloudflare.com/client/v4/accounts/60e5472a284dc71bbafbbfac8aa2a940/pages/projects/virtual-gamecenter',
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.previewAutoDeployDisabled, false);
  assert.equal(result.deploymentReady, false);
  assert.ok(!JSON.stringify(result).includes('private-token'));
});
test('readiness requires the unchanged main target and preview auto-deploy disabled', async () => {
  for (const branch of ['main', 'develop']) {
    const result = await checkStagingAccess('token', async url => Response.json({ success: true, result: url.endsWith('/script-settings') ? {} : {
      ...project, production_branch: branch, source: { config: { preview_deployment_setting: 'none' } },
    } }));
    assert.equal(result.deploymentReady, branch === 'main');
  }
});
test('missing tokens never send requests, and API failures never expose responses or exceptions', async () => {
  assert.equal((await checkStagingAccess('', () => assert.fail('unexpected request'))).ok, false);
  for (const request of [
    async () => new Response('private-token secret response', { status: 403 }),
    async () => { throw Error('private-token secret exception'); },
    async () => Response.json({ success: false, errors: ['private-token secret error'] }),
  ]) {
    const result = await checkStagingAccess('private-token', request);
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes('private-token'));
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
});
test('manual service check uses staging approval and separates API and Basic credentials', async () => {
  const workflow = parse(await readFile(new URL('../../.github/workflows/service-check.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  const job = workflow.jobs.check;
  assert.equal(job.environment, 'staging');
  assert.match(job.if, /refs\/heads\/develop/);
  assert.match(job.if, /papettoTV/);
  assert.ok(!job.env);
  const steps = job.steps;
  assert.equal(steps[0].with['persist-credentials'], false);
  const cloud = steps.find(step => step.run?.includes('staging-preflight.mjs'));
  const basic = steps.find(step => step.run?.includes('npm run service:check'));
  assert.deepEqual(Object.keys(cloud.env), ['CLOUDFLARE_API_TOKEN']);
  assert.deepEqual(Object.keys(basic.env), ['PULBASE_CHECK_USERNAME', 'PULBASE_CHECK_PASSWORD']);
  assert.match(basic.run, /--environment staging/);
  assert.ok(!JSON.stringify(workflow).includes('wrangler deploy'));
});


test('検証公開はCI成功イベントか運営者の手動実行だけで、ビルドと公開は別ジョブ', async () => {
  const workflow = parse(await readFile(new URL('../../.github/workflows/develop-staging.yml', import.meta.url), 'utf8'));
  const ready = workflow.jobs.ready;
  const allowed = new Function('github', 'vars', `return Boolean(${ready.if});`);
  for (const ref of ['refs/heads/develop', 'refs/heads/main']) {
    for (const event_name of ['workflow_dispatch', 'workflow_run', 'push']) {
      for (const actor of ['papettoTV', 'another-user']) {
        for (const flag of ['false', 'true', undefined]) {
          for (const conclusion of ['success', 'failure']) {
            const github = { ref, event_name, actor, repository: 'owner/repo', event: { workflow_run: { event: 'push', head_branch: 'develop', head_repository: { full_name: 'owner/repo' }, conclusion } } };
            const expected = (event_name === 'workflow_dispatch' && actor === 'papettoTV' && ref === 'refs/heads/develop') || (event_name === 'workflow_run' && flag === 'true' && conclusion === 'success');
            assert.equal(allowed(github, { PULBASE_STAGING_DEPLOY_ENABLED: flag }), expected);
          }
        }
      }
    }
  }
  for (const change of [{ event: 'pull_request' }, { head_branch: 'main' }, { head_repository: { full_name: 'fork/repo' } }]) {
    assert.equal(allowed({ event_name: 'workflow_run', repository: 'owner/repo', event: { workflow_run: { event: 'push', head_branch: 'develop', head_repository: { full_name: 'owner/repo' }, conclusion: 'success', ...change } } }, { PULBASE_STAGING_DEPLOY_ENABLED: 'true' }), false);
  }
  assert.equal(ready.environment, undefined);
  assert.equal(workflow.jobs.staging.environment, 'staging');
  assert.equal(workflow.jobs.staging.needs, 'ready');
  assert.deepEqual(workflow.jobs.regression.needs, ['ready', 'staging']);
  assert.equal(workflow.on.workflow_dispatch.inputs.dry_run.type, 'boolean');
});
