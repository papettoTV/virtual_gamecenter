import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { assertChanges, assertIssueNumber, assertSha } from './policy.mjs';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim();
const result = JSON.parse(await readFile(process.env.RESULT_FILE, 'utf8'));
const issue = assertIssueNumber(process.env.ISSUE_NUMBER);
const base = assertSha(process.env.BASE_SHA);
if (git('rev-parse', 'HEAD') !== base) throw Error('Unexpected checkout');
if (typeof result.patch !== 'string' || Buffer.byteLength(result.patch) > 90000 || !result.patch.trim()
  || result.patch.includes('GIT binary patch') || typeof result.summary !== 'string' || result.summary.length > 4000) throw Error('Invalid Codex patch output');
await writeFile(process.env.PATCH_FILE, result.patch);
// git apply rejects traversal/absolute paths. --index also records new files.
git('apply', '--index', '--check', process.env.PATCH_FILE);
git('apply', '--index', process.env.PATCH_FILE);
const paths = git('diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean);
assertChanges(paths.map(filename => ({ filename })));
const raw = git('diff', '--cached', '--raw', '--no-abbrev');
if (raw.split('\n').some(line => !/^:(?:000000|100644) (?:000000|100644) /.test(line))) throw Error('Only regular, non-executable text files are allowed');
const branch = `codex/issue-${issue}`;
git('checkout', '-b', branch);
git('config', 'user.name', 'Pulbase Automation');
git('config', 'user.email', 'pulbase-automation@users.noreply.github.com');
git('commit', '-m', `Resolve issue #${issue}`);
// A GitHub App token is supplied by the trusted publishing job, never to Codex.
git('push', 'origin', branch);
await writeFile(process.env.PR_BODY_FILE, `Issue #${issue} の自動実装候補です。\n\n${result.summary}\n\nRefs #${issue}\n\n検証結果はこのPRのチェック・実行証跡を参照してください。本番公開は含みません。\n`);
