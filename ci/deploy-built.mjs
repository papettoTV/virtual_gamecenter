// Only deploy an already checked build. Never run candidate tests with a Cloudflare token.
import { readFile, rm } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkReleaseBranch, checkReleaseConfig, checkBuildConfig } from '../apps/web/scripts/release-config.mjs';
import { assertSha } from './policy.mjs';
import { checkPages } from './check-pages.mjs';
const root = fileURLToPath(new URL('../apps/web/', import.meta.url));
try {
  const environment = process.argv[2];
  const sha = assertSha(process.env.PULBASE_RELEASE_SHA);
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (head !== sha || checkReleaseBranch(environment, branch).length) throw Error('Unexpected deployment revision or branch');
  const source = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
  const errors = checkReleaseConfig(source, environment);
  if (errors.length) throw Error(errors.join('\n'));
  const manifest = JSON.parse(await readFile(resolve(root, '.wrangler/deploy/config.json'), 'utf8'));
  const configPath = resolve(root, '.wrangler/deploy', manifest.configPath);
  if (!configPath.startsWith(resolve(root, 'dist') + sep)) throw Error('Build manifest escapes dist');
  const built = JSON.parse(await readFile(configPath, 'utf8'));
  const buildErrors = checkBuildConfig(built, source.env[environment], environment);
  if (buildErrors.length) throw Error(buildErrors.join('\n'));
  await checkPages(environment);
  await rm(resolve(dirname(configPath), '.dev.vars'), { force: true });
  execFileSync('npx', ['wrangler', 'deploy', '--config', configPath], { cwd: root, stdio: 'inherit' });
  execFileSync('npm', ['run', 'deploy:pages', '--', environment], { cwd: root, stdio: 'inherit' });
} catch (error) { console.error(error.message); process.exitCode = 1; }
