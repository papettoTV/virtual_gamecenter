import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const publisher = fileURLToPath(new URL('../publish-patch.mjs', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
test('publisher creates a real PR branch only for a valid, regular-file patch', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'pulbase-patch-'));
  try {
    const remote = join(temporary, 'remote.git'); const cwd = join(temporary, 'work');
    await mkdir(cwd); git(temporary, 'init', '--bare', remote); git(cwd, 'init', '-b', 'develop');
    git(cwd, 'config', 'user.name', 'Test'); git(cwd, 'config', 'user.email', 'test@example.invalid');
    await writeFile(join(cwd, 'README.md'), 'fixture\n'); git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'fixture');
    git(cwd, 'remote', 'add', 'origin', remote);
    const base = git(cwd, 'rev-parse', 'HEAD');
    const patch = 'diff --git a/docs/example.md b/docs/example.md\nnew file mode 100644\nindex 0000000..ce01362\n--- /dev/null\n+++ b/docs/example.md\n@@ -0,0 +1 @@\n+hello\n';
    const result = join(temporary, 'result.json');
    const env = { ...process.env, RESULT_FILE: result, PATCH_FILE: join(temporary, 'patch.diff'), PR_BODY_FILE: join(temporary, 'body.md'), ISSUE_NUMBER: '123', BASE_SHA: base };
    await writeFile(result, JSON.stringify({ patch, summary: '説明を追加' }));
    const allowed = spawnSync(process.execPath, [publisher], { cwd, env, encoding: 'utf8' });
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(git(cwd, 'show', 'HEAD:docs/example.md'), 'hello');
    assert.ok(git(temporary, '--git-dir', remote, 'rev-parse', 'refs/heads/codex/issue-123'));
    git(cwd, 'checkout', '-B', 'develop', base);
    await writeFile(result, JSON.stringify({ patch: patch.replaceAll('docs/example.md', '.github/workflows/example.yml'), summary: 'protected' }));
    const rejected = spawnSync(process.execPath, [publisher], { cwd, env, encoding: 'utf8' });
    assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /protected path/);
    assert.equal(git(cwd, 'branch', '--show-current'), 'develop');
    git(cwd, 'reset', '--hard', base);
    await writeFile(result, JSON.stringify({ patch: patch.replace('100644', '100755'), summary: 'executable' }));
    const executable = spawnSync(process.execPath, [publisher], { cwd, env, encoding: 'utf8' });
    assert.notEqual(executable.status, 0); assert.match(executable.stderr, /regular, non-executable/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
