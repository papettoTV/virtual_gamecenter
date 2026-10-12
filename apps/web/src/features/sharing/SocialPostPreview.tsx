import { getGameDefinition } from "../../domain/game";
import { presentResult } from "./result-presenters";
import type { SharePanelState } from "./share-service";
import type { SocialTarget } from "./social-targets";

export function SocialPostPreview({ panel, text, target, onChange }: { panel: SharePanelState; text: string; target: SocialTarget; onChange: (target: SocialTarget) => void }) {
  const game = getGameDefinition(panel.gameId);
  const presentation = panel.result ? presentResult(panel.result) : null;
  const title = presentation ? `${game?.title ?? panel.gameId} | ${presentation.headline} | PULBASE` : `${game?.title ?? panel.gameId}の観戦 | PULBASE`;
  const description = panel.result && presentation ? `${panel.result.playerName} · ${presentation.details.join(" · ")}` : "この筐体のプレイを観戦できます。開始前・終了後は筐体の状況をご案内します。";
  const imagePath = panel.kind === "result" ? `/results/${panel.targetId}/image.png` : `/share/live/${encodeURIComponent(panel.gameId)}/image.png`;
  return <section className="social-preview" aria-label="SNS投稿イメージ">
    <h3>投稿イメージ</h3>
    <div className="social-preview-tabs" role="group" aria-label="プレビューするSNS">
      <button type="button" aria-pressed={target === "facebook"} onClick={() => onChange("facebook")}>Facebook</button>
      <button type="button" aria-pressed={target === "x"} onClick={() => onChange("x")}>X</button>
    </div>
    <p className="social-preview-note">表示イメージです。実際のSNSのレイアウトやカード表示とは異なる場合があります。</p>
    {target === "facebook" && <p className="social-preview-note">以下は本文を貼り付けた場合のイメージです。FacebookにはURLだけを渡します。</p>}
    <article className={`social-post social-post-${target}`}>
      <header><span className="social-preview-avatar" aria-hidden="true">P</span><div><strong>投稿するユーザー</strong><small>{target === "facebook" ? "Facebook · 投稿イメージ" : "@your_account · 投稿イメージ"}</small></div></header>
      <p className="social-preview-copy">{text}</p>
      {target === "x" && <p className="social-preview-link">{panel.url}</p>}
      <div className="social-link-card">
        <img src={new URL(imagePath, location.origin).href} alt={`${game?.title ?? panel.gameId}のリンクカード画像`} width="1200" height="630" />
        <div><small>{new URL(panel.url).host}</small><strong>{title}</strong>{target === "facebook" && <p>{description}</p>}</div>
      </div>
    </article>
    <small>ローカルURL・限定公開URLはSNS側でプレビューできない場合があります。公開URLで最終確認してください。</small>
  </section>;
}
