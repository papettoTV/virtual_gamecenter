// This trusted runner consumes data only; no candidate npm script, Wrangler config, or build hook is executed.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { verifyStagingArtifact } from './staging-artifact.mjs';
import { assertDeploymentCi } from './ci-evidence.mjs';
import { assertPagesPipeline } from './check-pages.mjs';
import { checkReleaseConfig } from '../apps/web/scripts/release-config.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export function stagingWorkerConfig(source, directory) {
  if (source.account_id !== '60e5472a284dc71bbafbbfac8aa2a940' || checkReleaseConfig(source, 'staging').length) throw Error('Invalid trusted staging configuration');
  const selected = source.env.staging;
  const config = { name: selected.name, account_id: source.account_id, main: join(directory, 'worker/index.js'), no_bundle: true,
    compatibility_date: source.compatibility_date, compatibility_flags: source.compatibility_flags ?? [], workers_dev: false, preview_urls: false, routes: [],
    assets: { ...source.assets, directory: join(directory, 'client') }, migrations: source.migrations,
    observability: selected.observability ?? source.observability, triggers: selected.triggers ?? source.triggers };
  for (const key of ['vars', 'secrets', 'durable_objects', 'd1_databases', 'r2_buckets', 'ratelimits', 'analytics_engine_datasets']) config[key] = selected[key];
  // No field is read from the artifact's config. Source paths are never bundled by the deploy runner.
  return config;
}
export async function deployStagingArtifact(env = process.env, { command = execFileSync, guard = () => assertDeploymentCi(env), request = fetch } = {}) {
  const directory = resolve(env.PULBASE_ARTIFACT_DIRECTORY ?? 'ci/downloaded-build');
  const dryRun = env.PULBASE_DRY_RUN === 'true';
  if (!['true', 'false'].includes(env.PULBASE_DRY_RUN)) throw Error('Explicit deployment mode required');
  await verifyStagingArtifact({ directory, sha: env.PULBASE_RELEASE_SHA, tree: env.PULBASE_EXPECTED_TREE, runId: env.PULBASE_CI_RUN_ID, attempt: env.PULBASE_CI_ATTEMPT });
  const source = JSON.parse(await readFile(join(root, 'apps/web/wrangler.jsonc'), 'utf8'));
  const config = stagingWorkerConfig(source, directory);
  const prepared = resolve(env.RUNNER_TEMP ?? '/tmp', `pulbase-deploy-${env.GITHUB_RUN_ID ?? 'local'}-${env.GITHUB_RUN_ATTEMPT ?? '1'}`);
  await mkdir(join(prepared, 'pages'), { recursive: true });
  const workerPath = join(prepared, 'wrangler.json');
  await writeFile(workerPath, JSON.stringify(config));
  const pages = JSON.parse(await readFile(join(root, 'apps/web/pages/wrangler.jsonc'), 'utf8'));
  if (pages.name !== 'virtual-gamecenter' || pages.env?.preview?.services?.[0]?.service !== 'pulbase-staging') throw Error('Unexpected trusted Pages configuration');
  pages.pages_build_output_dir = join(directory, 'client');
  await writeFile(join(prepared, 'pages/wrangler.jsonc'), JSON.stringify(pages));
  const cli = join(root, 'apps/web/node_modules/.bin/wrangler');
  const commandOptions = { cwd: prepared, stdio: 'inherit', env: { ...env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false', CI: 'true' } };
  await guard();
  if (dryRun) {
    command(cli, ['deploy', '--config', workerPath, '--no-bundle', '--autoconfig=false', '--dry-run', '--outdir', join(prepared, 'dry-run')], commandOptions);
    console.log('同じSHAのCIと成果物を確認し、公開なしのdry-runが成功しました。Pagesも公開していません。');
    return;
  }
  if (!env.CLOUDFLARE_API_TOKEN) throw Error('Missing staging deployment token');
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${source.account_id}/pages/projects/virtual-gamecenter`;
  async function project(method = 'GET', body) {
    const response = await request(endpoint, { method, headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) { await response.body?.cancel(); throw Error('Pages preflight failed'); }
    const value = await response.json();
    if (!value.success) throw Error('Pages preflight failed');
    assertPagesPipeline(value.result, 'staging');
    return value.result;
  }
  const original = await project();
  await guard(); // Recheck CI and develop immediately before the first write.
  command(cli, ['deploy', '--config', workerPath, '--no-bundle', '--autoconfig=false'], commandOptions);
  await guard(); // If develop/PR changed after Worker upload, stop before Pages and report a partial deployment.
  await project();
  try {
    command(cli, ['pages', 'deploy', join(directory, 'client'), '--cwd', join(prepared, 'pages'), '--project-name', 'virtual-gamecenter', '--branch', 'develop', '--commit-hash', env.PULBASE_RELEASE_SHA, '--commit-dirty=true', '--no-bundle'], commandOptions);
  } finally {
    const latest = await project();
    if (JSON.stringify(latest.build_config) !== JSON.stringify(original.build_config)) await project('PATCH', { build_config: original.build_config });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { throw Error('旧develop公開CLIは停止済みです。'); }
  catch { console.error('staging公開を停止しました。CI・成果物・現在のdevelopを確認してください。Worker/Pagesの部分反映がある場合は復旧を判断してください。'); process.exitCode = 1; }
}
