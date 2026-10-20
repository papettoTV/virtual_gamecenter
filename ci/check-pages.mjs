import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function assertPagesPipeline(project, environment) {
  if (!['staging', 'production'].includes(environment) || project?.production_branch !== 'main') throw Error('Unexpected Pages target');
  const config = project.source?.config;
  const disabled = !project.source || config?.deployments_enabled === false;
  if (!disabled && config?.preview_deployment_setting !== 'none') throw Error('Disable Pages preview Git auto-deployments before enabling this pipeline');
  if (environment === 'production' && !disabled && config?.production_deployments_enabled !== false) throw Error('Disable Pages production Git auto-deployments before releasing main');
}
export async function checkPages(environment, request = fetch) {
  const config = JSON.parse(await readFile(new URL('../apps/web/wrangler.jsonc', import.meta.url), 'utf8'));
  if (!/^[a-f0-9]{32}$/.test(config.account_id) || !process.env.CLOUDFLARE_API_TOKEN) throw Error('Cloudflare API credentials missing');
  const response = await request(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/pages/projects/virtual-gamecenter`, {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error('Pages preflight failed');
  const result = await response.json();
  if (!result.success) throw Error('Pages preflight failed');
  assertPagesPipeline(result.result, environment);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkPages(process.argv[2]).then(() => console.log('Pages target and CI deployment ownership verified'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
