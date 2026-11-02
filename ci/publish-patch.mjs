import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { assertChanges, assertIssueNumber, assertSha } from './policy.mjs';
import { PublicationStopped, publicationFailure, validatePublicationResult } from './publication-result.mjs';
import {assertResumeSnapshot} from './automatic-resume.mjs';
import {assertAutomaticIssue} from './issue-routing.mjs';
import {prepareImageAssets,writeImage,imagePath} from './image-assets.mjs';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim();
try {
  const text = await readFile(process.env.RESULT_FILE, 'utf8');
  let result;
  try { result = JSON.parse(text); } catch {
    throw new PublicationStopped('invalid_result', '自動実装の出力がJSONではありません。PRは作成していません。');
  }
  const issue = assertIssueNumber(process.env.ISSUE_NUMBER);
  const base = assertSha(process.env.BASE_SHA);
  const trustedBase=assertSha(process.env.TRUSTED_BASE_SHA||base),pull=process.env.PULL_NUMBER;
  if (git('rev-parse', 'HEAD') !== trustedBase) throw Error('Unexpected trusted checkout');
  const recheck=()=>{
    if(!pull)return;
    const number=assertIssueNumber(pull),repository='papettoTV/virtual_gamecenter';
    assertAutomaticIssue(JSON.parse(execFileSync('gh',['api',`repos/${repository}/issues/${issue}`],{encoding:'utf8',stdio:['ignore','pipe','pipe']})));
    const pr=JSON.parse(execFileSync('gh',['api',`repos/${repository}/pulls/${number}`],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
    assertResumeSnapshot(pr,{issue,pull:number,head:assertSha(process.env.PR_HEAD_SHA),candidate:base,trustedBase,bot:process.env.AUTOMATION_BOT,repository});
    if(git('ls-remote','origin',`refs/heads/codex/issue-${issue}`).split(/\s/)[0]!==pr.head.sha)throw Error('Remote branch moved');
  };
  validatePublicationResult(result);
  // Download in the trusted runner with no GitHub credentials forwarded. Validate
  // all bytes before writing any asset; signed redirect URLs are never logged.
  let assets;
  try { assets=await prepareImageAssets(result.assets??[]); } catch {
    throw new PublicationStopped('invalid_result', '画像素材の取得・容量・形式・SHA-256照合に失敗しました。PRは作成していません。');
  }
  if(pull){
    recheck();git('fetch','--no-tags','origin',base);
    if(git('rev-parse',`${base}^1`)!==trustedBase||git('rev-parse',`${base}^2`)!==process.env.PR_HEAD_SHA)throw Error('Merge parents changed');
    assertChanges(git('diff','--name-only','-z',trustedBase,base).split('\0').filter(Boolean).map(filename=>({filename})));
    if(git('diff','--raw','--no-abbrev',trustedBase,base).split('\n').some(line=>line&&!/^:(?:000000|100644) (?:000000|100644) /.test(line)))throw Error('Existing PR has non-regular files');
    // All executable publisher modules were imported from the trusted base before
    // this checkout. Never execute candidate code with the App token present.
    git('checkout','--detach',base);
  }else if(base!==trustedBase)throw Error('Untrusted base without an existing PR');
  await writeFile(process.env.PATCH_FILE, result.patch);
  try {
    if(result.patch.trim()){
      git('apply', '--index', '--check', process.env.PATCH_FILE);
      git('apply', '--index', process.env.PATCH_FILE);
    }
    if(git('diff','--cached','--name-only','-z').split('\0').some(imagePath))throw Error('Images must use the asset manifest');
    for(const asset of assets){await writeImage(process.cwd(),asset.path,asset.bytes);git('add','--',asset.path);}
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
    throw new PublicationStopped('invalid_patch', '実行可能ファイル・シンボリックリンクは許可していません。通常の非実行テキスト・検証済みPNG/JPEGだけが対象です。PRは作成していません。');
  }
  const branch = `codex/issue-${issue}`;
  git('checkout', '-b', branch);
  git('config', 'user.name', 'Pulbase Automation');
  git('config', 'user.email', 'pulbase-automation@users.noreply.github.com');
  git('commit', '-m', `Issue #${issue} の対応`);
  recheck();
  git('push', 'origin', branch);
  await writeFile(process.env.PR_BODY_FILE, `Issue #${issue} の自動実装候補です。\n\n${result.summary}\n\nCloses #${issue}\n\n検証結果はこのPRのチェック・実行証跡を参照してください。本番公開は含みません。\n`);
} catch (error) {
  const failure = publicationFailure(error);
  if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `failure=${JSON.stringify(failure)}\n`, { flag: 'a' });
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `\n### 自動実装の停止（${failure.code}）\n\n${failure.reason.replaceAll('\r', '').split('\n').map(line => `> ${line}`).join('\n')}\n`, { flag: 'a' });
  console.error(`自動実装の停止：${JSON.stringify(failure)}`);
  process.exitCode = 1;
}
