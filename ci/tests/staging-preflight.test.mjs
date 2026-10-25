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


test('旧develop公開経路はイベント起動・Environment・Secret・公開命令を持たず必ず停止', async () => {
  const workflow = parse(await readFile(new URL('../../.github/workflows/develop-staging.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, {});
  assert.ok(!JSON.stringify(workflow).includes('secrets.'));
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.environment, undefined);
    assert.ok(job.steps.some(step => step.run?.includes('exit 1')));
    assert.ok(!JSON.stringify(job).includes('deploy-staging-artifact'));
  }
});
