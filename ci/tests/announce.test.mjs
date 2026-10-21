import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { announcementText, releaseAnnouncement, writeReleaseAnnouncement } from '../release-announcement.mjs';
const sha = 'a'.repeat(40);

test('文面出力は本番回帰成功と有効なSHA・短い告知文を必須にする', () => {
  const options = { sha, text: 'PULBASEを更新しました。', confirmed: true };
  assert.throws(() => releaseAnnouncement({ ...options, confirmed: false }));
  assert.throws(() => releaseAnnouncement({ ...options, confirmed: 'true' }));
  assert.throws(() => releaseAnnouncement({ ...options, sha: 'main' }));
  assert.throws(() => announcementText(''));
  assert.throws(() => announcementText('あ'.repeat(141)));
  assert.throws(() => announcementText('更新\u0000'));
  assert.equal(announcementText(' あいうえお '), 'あいうえお');
});

test('手動投稿と未投稿を明示し、入力中のMarkdownも文面欄に閉じ込める', () => {
  const text = '更新しました。\n```\n手動で確認してください。';
  const draft = releaseAnnouncement({ sha, text, confirmed: true });
  assert.equal(draft.text, text);
  assert.ok(draft.summary.includes(`対象リリースSHA: \`${sha}\``));
  assert.ok(draft.summary.includes('Xへの投稿は未実施です。'));
  assert.ok(draft.summary.includes(`\n\`\`\`\`text\n${text}\n\`\`\`\`\n`));
});

test('コピー用テキストとサマリーを保存し、再生成しても外部送信しない', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pulbase-announcement-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('外部送信は禁止'); };
  try {
    const summaryPath = join(directory, 'summary.md');
    const options = { sha, text: 'PULBASEを更新しました。\nhttps://pulbase.com', confirmed: true };
    const first = await writeReleaseAnnouncement(options, { directory, summaryPath });
    const second = await writeReleaseAnnouncement(options, { directory, summaryPath });
    assert.deepEqual(first, second);
    assert.equal(await readFile(join(directory, 'release-announcement.txt'), 'utf8'), `${options.text}\n`);
    assert.equal(await readFile(join(directory, 'release-announcement.md'), 'utf8'), first.summary);
    assert.equal(await readFile(summaryPath, 'utf8'), first.summary.repeat(2));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('本番回帰が成功していなければ告知成果物も作成しない', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pulbase-announcement-blocked-'));
  const directory = join(root, 'results');
  try {
    await assert.rejects(writeReleaseAnnouncement({ sha, text: '更新', confirmed: false }, { directory }));
    await assert.rejects(readFile(join(directory, 'release-announcement.txt')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
