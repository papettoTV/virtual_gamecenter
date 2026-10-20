import { pathToFileURL } from 'node:url';
import { assertSha } from './policy.mjs';
export const origins = { staging: 'https://develop.virtual-gamecenter.pages.dev', production: 'https://pulbase.com' };
export function checkTarget(environment, expectedSha, confirmProduction = false) {
  assertSha(expectedSha);
  if (!Object.hasOwn(origins, environment) || (environment === 'production' && !confirmProduction)) throw Error('Explicit deployment environment and production confirmation required');
  return origins[environment];
}
export async function checkRevision({ environment, sha, username, password, confirmProduction }, request = fetch) {
  const origin = checkTarget(environment, sha, confirmProduction);
  if ((username || password) && !(username && password)) throw Error('Incomplete credentials');
  const headers = username ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` } : {};
  const response = await request(`${origin}/?release-check=${sha}`, { headers, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  await response.body?.cancel();
  if (response.status !== 200 || response.headers.get('X-Pulbase-Revision') !== sha
    || response.headers.get('X-Pulbase-Gateway-Revision') !== sha) throw Error('Deployed Worker/Pages revision does not match the verified candidate');
  return { environment, sha, ok: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkRevision({ environment: process.argv[2], sha: process.env.PULBASE_EXPECTED_SHA,
    username: process.env.PULBASE_CHECK_USERNAME, password: process.env.PULBASE_CHECK_PASSWORD,
    confirmProduction: process.argv.includes('--confirm-production') }).then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error('Deployment revision check failed'); process.exitCode = 1; });
}
