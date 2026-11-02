import {assetPlan} from './image-assets.mjs';
export class PublicationStopped extends Error {
  constructor(code, reason) {
    super(reason);
    this.code = code;
  }
}

export function validatePublicationResult(result) {
  if (!result || typeof result.summary !== 'string' || result.summary.length > 4000
    || typeof result.patch !== 'string' || Buffer.byteLength(result.patch) > 90000
    || result.patch.includes('GIT binary patch')) {
    throw new PublicationStopped('invalid_result', '自動実装の出力形式・サイズが不正です。PRは作成していません。');
  }
  try { assetPlan(result.assets); } catch {
    throw new PublicationStopped('invalid_result', '画像素材一覧の保存先・取得URL・ハッシュ・件数が不正です。PRは作成していません。');
  }
  if (!result.patch.trim() && !(result.assets?.length)) {
    throw new PublicationStopped('no_patch', `実装候補の差分が返されなかったため停止しました。PRは作成していません。\n\n実装側の説明：\n${result.summary || '説明は返されませんでした。'}`);
  }
  return result;
}

export function publicationFailure(error) {
  if (error instanceof PublicationStopped) return { code: error.code, reason: error.message };
  return { code: 'publish_failed', reason: '差分の適用・安全検査・ブランチ公開・PR作成のいずれかで失敗しました。Actionsの失敗ステップを確認してください。自動再実行や制限の緩和はしていません。' };
}

export function publicationFailureText(value) {
  let failure;
  try { failure = JSON.parse(value); } catch { return ''; }
  if (!['no_patch', 'invalid_result', 'invalid_patch', 'protected_path', 'publish_failed'].includes(failure?.code)
    || typeof failure.reason !== 'string' || failure.reason.length > 5000) return '';
  return `\n\n停止区分：\`${failure.code}\`\n\n${failure.reason.replaceAll('\r', '').split('\n').map(line => `> ${line}`).join('\n')}`;
}
