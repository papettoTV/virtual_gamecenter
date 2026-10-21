// Read-only checks of fixed staging targets. Never print API responses or exception messages.
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const account = '60e5472a284dc71bbafbbfac8aa2a940';
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
export async function checkStagingAccess(token, request = fetch) {
  const checks = [];
  let previewAutoDeployDisabled = null;
  for (const [name, path] of [
    ['staging_worker_access', '/workers/scripts/pulbase-staging/script-settings'],
    ['pages_project_access', '/pages/projects/virtual-gamecenter'],
  ]) {
    const record = { name, ok: false, status: null, reason: null };
    if (!token) { record.reason = 'token_missing'; checks.push(record); continue; }
    try {
      const response = await request(base + path, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` },
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      record.status = response.status;
      if (!response.ok) {
        await response.body?.cancel();
        record.reason = 'api_access_failed';
      } else {
        const body = await response.json();
        record.ok = body.success === true && !!body.result && typeof body.result === 'object';
        if (!record.ok) record.reason = 'api_response_invalid';
        if (name === 'pages_project_access' && record.ok) {
          const project = body.result;
          record.ok = project.name === 'virtual-gamecenter' && project.production_branch === 'main';
          if (!record.ok) record.reason = 'pages_target_mismatch';
          const config = project.source?.config;
          previewAutoDeployDisabled = !project.source || config?.deployments_enabled === false
            || config?.preview_deployment_setting === 'none';
        }
      }
    } catch { record.ok = false; record.reason = 'request_failed'; }
    checks.push(record);
  }
  const ok = checks.every(check => check.ok);
  return { ok, checks, previewAutoDeployDisabled, deploymentReady: ok && previewAutoDeployDisabled === true };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkStagingAccess(process.env.CLOUDFLARE_API_TOKEN);
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `Cloudflare staging read access: ${result.ok ? 'passed' : 'failed'}. Pages preview auto-deploy disabled: ${result.previewAutoDeployDisabled === null ? 'unknown' : result.previewAutoDeployDisabled}.\n\nThis check made GET requests only. Write permissions and deployment behavior were not tested.\n`);
  }
  if (!result.ok) process.exitCode = 1;
}
