import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyProductionBundle } from './build-bundle.mjs';
import { assertStagingPages, preservePagesBuildMetadata, samePagesConfiguration } from '../control/staging-publication.mjs';

const account = '60e5472a284dc71bbafbbfac8aa2a940';
const worker = 'pulbase-production';
const project = 'virtual-gamecenter';
const targets = ['account_id','name','compatibility_date','compatibility_flags','migrations','assets','observability','triggers',
  'vars','secrets','durable_objects','d1_databases','r2_buckets','ratelimits','analytics_engine_datasets','workers_dev','preview_urls','no_bundle','routes'];

function ensure(condition, message) {
  if (!condition) throw Error(message);
}

export function validateProductionTarget(config) {
  ensure(config.account_id === account && config.name === worker && config.no_bundle === true
    && config.workers_dev === false && config.preview_urls === false && Array.isArray(config.routes) && config.routes.length === 0
    && config.assets?.binding === 'ASSETS' && config.assets.run_worker_first === true
    && config.vars?.APP_ENV === 'production' && config.vars.PUBLIC_BETA_ENABLED === 'true'
    && config.vars.DEVELOPER_AUTH_ENABLED === 'false' && config.vars.CREDIT_PURCHASES_ENABLED === 'false'
    && config.d1_databases?.length === 1 && config.d1_databases[0].binding === 'DB'
    && config.d1_databases[0].database_name === worker
    && config.d1_databases[0].database_id === 'af463342-06e5-4904-97fc-6569d59ceec3'
    && config.r2_buckets?.length === 1 && config.r2_buckets[0].binding === 'DELETION_AUDIT'
    && config.r2_buckets[0].bucket_name === 'pulbase-production-deletion-audit'
    && Object.keys(config).every(key => targets.includes(key)),
  '本番の固定公開先・認証・購入設定と一致しません。');
}

export async function prepareProductionPublication(artifact, scope, scratch = tmpdir()) {
  ensure(/^[a-f0-9]{64}$/.test(scope.expectedDigest ?? ''), '承認対象の成果物ハッシュが必要です。');
  const verified = await verifyProductionBundle({ directory: artifact, ...scope });
  const options = JSON.parse(await readFile(new URL('./production-target.json', import.meta.url), 'utf8'));
  validateProductionTarget(options);
  const gateway = await readFile(new URL('../control/staging-gateway.mjs', import.meta.url), 'utf8');
  ensure(await readFile(join(artifact,'client/_worker.js'),'utf8') === gateway.replace('__PULBASE_GATEWAY_REVISION__',verified.revision),
    'Pagesゲートウェイが保護された定義と一致しません。');
  const directory = await mkdtemp(join(scratch,'pulbase-fixed-production-'));
  const pagesDirectory = join(directory,'pages');
  await mkdir(pagesDirectory);
  const workerConfig = join(directory,'worker.json');
  const bindings = (environment, name) => ({ vars: { APP_ENV: environment }, services: [{ binding: 'BACKEND', service: name }] });
  await writeFile(workerConfig,JSON.stringify({
    ...options, main: resolve(artifact,'worker/index.js'), assets: {...options.assets,directory:resolve(artifact,'client')},
    d1_databases: options.d1_databases.map(database=>({...database,migrations_dir:resolve(artifact,'migrations')})),
  }));
  await writeFile(join(pagesDirectory,'wrangler.jsonc'),JSON.stringify({
    name:project,pages_build_output_dir:resolve(artifact,'client'),compatibility_date:options.compatibility_date,
    ...bindings('production',worker),env:{preview:bindings('staging','pulbase-staging')},
  }));
  return Object.freeze({ artifact:resolve(artifact), scope:Object.freeze({...scope}), directory,pagesDirectory,workerConfig,
    sha:verified.revision,manifestDigest:verified.manifestDigest });
}

export function productionCommands(plan) {
  return {
    worker:['deploy','--config',plan.workerConfig,'--no-bundle','--autoconfig=false'],
    pages:['pages','deploy',join(plan.artifact,'client'),'--cwd',plan.pagesDirectory,'--project-name',project,
      '--branch','main','--commit-hash',plan.sha,'--commit-dirty=false','--no-bundle'],
  };
}

// Direct Upload sends this exact SHA-256 as wrangler_config_hash in its multipart request.
export async function pagesUploadConfigHash(plan) {
  return createHash('sha256').update(await readFile(join(plan.pagesDirectory, 'wrangler.jsonc'))).digest('hex');
}

export function assertProductionPagesConfiguration(before, after, uploadHash) {
  function withoutUploadHash(project) {
    const production = project.deployment_configs?.production;
    if (!production || uploadHash === undefined || production.wrangler_config_hash !== uploadHash) return project;
    return { ...project, deployment_configs: { ...project.deployment_configs, production: {
      ...production, wrangler_config_hash: before.deployment_configs?.production?.wrangler_config_hash,
    } } };
  }
  assertStagingPages(after);
  const preview = project => ({ ...project, deployment_configs: { production: project.deployment_configs?.preview } });
  ensure(samePagesConfiguration(before, withoutUploadHash(after))
    && samePagesConfiguration(preview(before), preview(after))
    && JSON.stringify(before.domains?.toSorted()) === JSON.stringify(after.domains?.toSorted()),
  '共有Pages設定が変わりました。');
}

export async function executeProductionPublication(plan,{ guard, transport, pause }) {
  ensure(typeof guard === 'function' && typeof transport.project === 'function'
    && typeof transport.execute === 'function', '承認後の保護検査と固定transportが必要です。');
  const recheck = async () => {
    await guard();
    await verifyProductionBundle({ directory:plan.artifact,...plan.scope });
  };
  const commands = productionCommands(plan);
  let phase = 'preflight';
  let workerUploaded = false;
  try {
    await recheck();
    const original = await transport.project();
    assertStagingPages(original); // Shared project: Git deployment must remain disabled for both environments.
    ensure(original.domains?.includes('pulbase.com'), '本番ドメインが一致しません。');
    await preservePagesBuildMetadata(plan,original);
    const uploadHash = await pagesUploadConfigHash(plan);
    await recheck();
    phase = 'worker';
    await transport.execute('worker',commands.worker,plan.directory);
    workerUploaded = true;
    await recheck();
    phase = 'pages';
    const beforePages = await transport.project();
    assertStagingPages(beforePages);
    ensure(samePagesConfiguration(original,beforePages), '公開の途中で共有Pages設定が変更されました。');
    const published = await transport.execute('pages',commands.pages,plan.directory);
    phase = 'pages-readback';
    for (let attempt = 0; ; attempt += 1) {
      const after = await transport.project();
      const active = after.canonical_deployment;
      if (active?.id === published.deploymentId
        && active.environment === 'production'
        && active.latest_stage?.status === 'success'
        && active.deployment_trigger?.metadata?.commit_hash === plan.sha) {
        phase = 'pages-configuration';
        assertProductionPagesConfiguration(original, after, uploadHash);
        break;
      }
      ensure(attempt < 5 && active?.id === original.canonical_deployment?.id,
        'Pagesの公開後配信ID・SHAが一致しません。');
      await pause(2000);
    }
    return { sha:plan.sha,workerUploaded,pagesUploaded:true };
  } catch (cause) {
    const error = Error('本番公開処理を停止しました。既存の配信状態を確認してください。', { cause });
    error.phase = phase;
    error.workerUploaded = workerUploaded;
    throw error;
  }
}
