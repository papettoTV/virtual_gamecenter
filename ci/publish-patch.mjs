import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { assertChanges, assertIssueNumber, assertSha } from './policy.mjs';
import { PublicationStopped, publicationFailure, validatePublicationResult } from './publication-result.mjs';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim();
try {
  const text = await readFile(process.env.RESULT_FILE, 'utf8');
  let result;
  try { result = JSON.parse(text); } catch {
    throw new PublicationStopped('invalid_result', '自動実装の出力がJSONではありません。PRは作成していません。');
  }
  const issue = assertIssueNumber(process.env.ISSUE_NUMBER);
  const base = assertSha(process.env.BASE_SHA);
  if (git('rev-parse', 'HEAD') !== base) throw Error('Unexpected checkout');
  validatePublicationResult(result);
  await writeFile(process.env.PATCH_FILE, result.patch);
  try {
    git('apply', '--index', '--check', process.env.PATCH_FILE);
    git('apply', '--index', process.env.PATCH_FILE);
  } catch {
    throw new PublicationStopped('invalid_patch', '差分を指定のベースに安全に適用できませんでした。PRは作成していません。');
  }
  const paths = git('diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean);
  try {
    assertChanges(paths.map(filename => ({ filename })));
  } catch {
    throw new PublicationStopped('protected_path', '変更対象に自動実装の許可範囲外のファイルがあります。人による確認が必要です。PRは作成していません。');
  }
  const raw = git('diff', '--cached', '--raw', '--no-abbrev');
  if (raw.split('\n').some(line => !/^:(?:000000|100644) (?:000000|100644) /.test(line))) {
    throw new PublicationStopped('invalid_patch', '実行可能ファイル・シンボリックリンクは許可していません。通常の非実行テキストファイルだけが対象です。PRは作成していません。');
  }
  const branch = `codex/issue-${issue}`;
  git('checkout', '-b', branch);
  git('config', 'user.name', 'Pulbase Automation');
  git('config', 'user.email', 'pulbase-automation@users.noreply.github.com');
  git('commit', '-m', `Issue #${issue} の対応`);
  git('push', 'origin', branch);
  await writeFile(process.env.PR_BODY_FILE, `Issue #${issue} の自動実装候補です。\n\n${result.summary}\n\nRefs #${issue}\n\n検証結果はこのPRのチェック・実行証跡を参照してください。本番公開は含みません。\n`);
} catch (error) {
  const failure = publicationFailure(error);
  if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `failure=${JSON.stringify(failure)}\n`, { flag: 'a' });
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `\n### 自動実装の停止（${failure.code}）\n\n${failure.reason.replaceAll('\r', '').split('\n').map(line => `> ${line}`).join('\n')}\n`, { flag: 'a' });
  console.error(`自動実装の停止：${JSON.stringify(failure)}`);
  process.exitCode = 1;
}
