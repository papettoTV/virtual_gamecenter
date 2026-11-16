import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertSha } from './policy.mjs';

export function announcementText(text) {
  // Keep the existing conservative limit for a short Japanese announcement.
  if (typeof text !== 'string' || !text.trim() || Array.from(text).length > 140 || /[\u0000-\u0008\u000B-\u001F]/.test(text)) throw Error('告知文は1〜140文字で指定してください。');
  return text.trim();
}

export function releaseAnnouncement({ sha, text, confirmed }) {
  assertSha(sha);
  text = announcementText(text);
  if (confirmed !== true) throw Error('本番の回帰テスト成功が必要です。');
  // A fence in the supplied text must not escape the copyable draft section.
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)));
  const summary = `## Xへの手動投稿用リリース文面\n\n本番公開と回帰テストが成功しました。**Xへの投稿は未実施です。**\n内容を確認し、次の文面をコピーして手動で投稿してください。\n\n${fence}text\n${text}\n${fence}\n\n対象リリースSHA: \`${sha}\`\n\n文面の再生成でもXへは送信しません。投稿済みかどうかはX上で確認してください。\n`;
  return { text, summary };
}

export async function writeReleaseAnnouncement(options, { directory = 'ci/results', summaryPath = process.env.GITHUB_STEP_SUMMARY } = {}) {
  const draft = releaseAnnouncement(options);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'release-announcement.txt'), `${draft.text}\n`);
  await writeFile(resolve(directory, 'release-announcement.md'), draft.summary);
  if (summaryPath) await appendFile(summaryPath, draft.summary);
  return draft;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeReleaseAnnouncement({ sha: process.env.PULBASE_RELEASE_SHA, text: process.env.PULBASE_ANNOUNCEMENT,
    confirmed: process.env.PULBASE_PRODUCTION_REGRESSION_PASSED === 'true',
  }).then(() => console.log('手動投稿用の文面を保存しました。Xへの投稿は行っていません。'))
    .catch(() => { console.error('文面の生成に失敗しました。入力と回帰テスト結果を確認してください。'); process.exitCode = 1; });
}
