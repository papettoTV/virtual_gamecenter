import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const publisher = fileURLToPath(new URL('../publish-patch.mjs', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
for (const filename of ['docs/example.md', 'apps/web/src/games/graze-duel/rendering/example.js']) test(`publisher accepts only a regular-file patch: ${filename}`, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'pulbase-patch-'));
  try {
    const remote = join(temporary, 'remote.git'); const cwd = join(temporary, 'work');
    await mkdir(cwd); git(temporary, 'init', '--bare', remote); git(cwd, 'init', '-b', 'develop');
    git(cwd, 'config', 'user.name', 'Test'); git(cwd, 'config', 'user.email', 'test@example.invalid');
    await writeFile(join(cwd, 'README.md'), 'fixture\n'); git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'fixture');
    git(cwd, 'remote', 'add', 'origin', remote);
    const base = git(cwd, 'rev-parse', 'HEAD');
    const patch = 'diff --git a/docs/example.md b/docs/example.md\nnew file mode 100644\nindex 0000000..ce01362\n--- /dev/null\n+++ b/docs/example.md\n@@ -0,0 +1 @@\n+hello\n'.replaceAll('docs/example.md', filename);
    const result = join(temporary, 'result.json');
    const env = { ...process.env, RESULT_FILE: result, PATCH_FILE: join(temporary, 'patch.diff'), PR_BODY_FILE: join(temporary, 'body.md'), ISSUE_NUMBER: '123', BASE_SHA: base,
      GITHUB_OUTPUT: join(temporary, 'output'), GITHUB_STEP_SUMMARY: join(temporary, 'summary') };
    await writeFile(result, JSON.stringify({ patch, summary: '説明を追加' }));
    const allowed = spawnSync(process.execPath, [publisher], { cwd, env, encoding: 'utf8' });
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.match(await readFile(env.PR_BODY_FILE, 'utf8'), /Closes #123/);
    assert.equal(git(cwd, 'show', `HEAD:${filename}`), 'hello');
    assert.ok(git(temporary, '--git-dir', remote, 'rev-parse', 'refs/heads/codex/issue-123'));
    git(cwd, 'checkout', '-B', 'develop', base);
    await writeFile(result, JSON.stringify({ patch: patch.replaceAll(filename, '.github/workflows/example.yml'), summary: 'protected' }));
    const rejected = spawnSync(process.execPath, [publisher], { cwd, env, encoding: 'utf8' });
    assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /protected_path/);
    assert.equal(git(cwd, 'branch', '--show-current'), 'develop');
    git(cwd, 'reset', '--hard', base);
    await writeFile(result, JSON.stringify({ patch: patch.replace('100644', '100755'), summary: 'executable' }));
    const executable = spawnSync(process.execPath, [publisher], { cwd, env, encoding: 'utf8' });
    assert.notEqual(executable.status, 0); assert.match(executable.stderr, /invalid_patch/); assert.match(executable.stderr, /非実行テキスト/);
    git(cwd, 'reset', '--hard', base);
    await writeFile(result, JSON.stringify({ patch: patch.replace('100644', '120000'), summary: 'symlink' }));
    const symlink = spawnSync(process.execPath, [publisher], { cwd, env, encoding: 'utf8' });
    assert.notEqual(symlink.status, 0); assert.match(symlink.stderr, /invalid_patch/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('empty implementation reports its reason without applying a patch or publishing a branch', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'pulbase-stopped-'));
  try {
    const cwd = join(temporary, 'work'); await mkdir(cwd);
    git(cwd, 'init', '-b', 'develop'); git(cwd, 'config', 'user.name', 'Test'); git(cwd, 'config', 'user.email', 'test@example.invalid');
    await writeFile(join(cwd, 'README.md'), 'fixture\n'); git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'fixture');
    const base = git(cwd, 'rev-parse', 'HEAD');
    const result = join(temporary, 'result.json'), output = join(temporary, 'output'), summary = join(temporary, 'summary');
    const explanation = '対象ファイルは保護範囲のため人の対応が必要です。\n::error::未信頼の出力\n許可ルールは変更していません。';
    await writeFile(result, JSON.stringify({ patch: '', summary: explanation }));
    const env = { ...process.env, RESULT_FILE: result, PATCH_FILE: join(temporary, 'patch.diff'), ISSUE_NUMBER: '12', BASE_SHA: base, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary };
    const stopped = spawnSync(process.execPath, [publisher], { cwd, env, encoding: 'utf8' });
    assert.equal(stopped.status, 1);
    assert.match(stopped.stderr, /no_patch/); assert.match(stopped.stderr, /人の対応が必要/);
    assert.ok(!stopped.stderr.includes('\n::error::'));
    assert.doesNotMatch(stopped.stderr, /Invalid Codex patch output/);
    const failure = JSON.parse((await readFile(output, 'utf8')).trim().slice('failure='.length));
    assert.equal(failure.code, 'no_patch'); assert.ok(failure.reason.includes(explanation));
    assert.match(await readFile(summary, 'utf8'), /人の対応/);
    assert.equal(git(cwd, 'rev-parse', 'HEAD'), base);
    assert.equal(git(cwd, 'branch', '--show-current'), 'develop');
    assert.equal(git(cwd, 'status', '--porcelain'), '');
    await writeFile(result, 'invalid JSON');
    const malformed = spawnSync(process.execPath, [publisher], { cwd, env, encoding: 'utf8' });
    assert.equal(malformed.status, 1); assert.match(malformed.stderr, /invalid_result/);
    assert.equal(git(cwd, 'rev-parse', 'HEAD'), base);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
