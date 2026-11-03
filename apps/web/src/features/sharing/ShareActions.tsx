import { drawBrandWordmark } from "../../brand/wordmark-raster";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SharedResult, SharedResultDraft } from "../../domain/shared-result";
import { resultSharing } from "./result-sharing";
import { liveSharing, shareLive, sharePanel } from "./share-service";
import { presentResult } from "./result-presenters";
import { getResultImageRenderer } from "./result-images";
import { recordSharingEvent } from "./sharing-events";
import { copySharedText } from "../notifications/share";
import { createSocialShareUrl, type SocialTarget } from "./social-targets";
import { SocialPostPreview } from "./SocialPostPreview";
import "./sharing.css";

export function ResultShareButton({ draft, placement }: { draft?: SharedResultDraft; placement?: string }) {
  const current = useSyncExternalStore(resultSharing.subscribe, resultSharing.getSnapshot);
  if (!draft && !current) return null;
  return <button className="result-share-button" data-placement={placement} type="button" onClick={event => {
    event.currentTarget.focus();
    if (draft) {
      if ("playerName" in draft && "createdAt" in draft) resultSharing.usePublished(draft as SharedResult);
      else resultSharing.setResult(draft);
    }
    void resultSharing.share(placement === "result-page");
  }}>結果を共有</button>;
}

export function LiveShareButton() {
  const context = useSyncExternalStore(liveSharing.subscribe, liveSharing.getSnapshot);
  if (!context || context.role !== "player" || !["ready", "paused"].includes(context.phase)) return null;
  return <div className="safe-live-share"><button type="button" onClick={event => { event.currentTarget.focus(); void shareLive(context); }}>観戦に招待</button></div>;
}

export function ResultCard({ result, playerName }: { result: SharedResultDraft; playerName?: string }) {
  const presentation = presentResult(result);
  return <section className="shared-result-card" style={{ borderColor: presentation.accent }}>
    <p className="eyebrow">PULBASE / {presentation.title}</p>
    <h2>{presentation.headline}</h2>
    {presentation.details.map(detail => <p key={detail}>{detail}</p>)}
    {playerName !== undefined && <p className="share-player-name">{playerName}</p>}
  </section>;
}

export async function createResultImage(result: SharedResult): Promise<File> {
  const presentation = presentResult(result);
  const canvas = document.createElement("canvas");
  canvas.width = 1200; canvas.height = 630;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("image_unavailable");
  const gradient = context.createLinearGradient(0, 0, 1200, 630);
  gradient.addColorStop(0, "#0c263b"); gradient.addColorStop(1, "#080918");
  context.fillStyle = gradient; context.fillRect(0, 0, 1200, 630);
  context.strokeStyle = presentation.accent; context.lineWidth = 4; context.strokeRect(32, 32, 1136, 566);
  context.fillStyle = presentation.accent; context.font = "bold 30px system-ui";
  drawBrandWordmark(context, 64, 50);
  context.fillStyle = presentation.accent;
  context.fillText(presentation.title, 64, 130, 1072);
  context.fillStyle = "#f3f5ff"; context.font = "bold 65px system-ui";
  context.fillText(presentation.headline, 64, 206, 1072);
  context.font = "32px system-ui";
  presentation.details.slice(0, 3).forEach((line, index) => context.fillText(line, 68, 292 + index * 60, 1060));
  context.fillStyle = "#aeb9d3"; context.font = "24px system-ui";
  context.fillText(`${result.playerName} / ${new Date(result.createdAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}`, 68, 538, 1060);
  const customRenderer = await getResultImageRenderer(result.gameId);
  if (customRenderer) await customRenderer(context, result);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("image_unavailable");
  return new File([blob], `${result.gameId}-result.png`, { type: "image/png" });
}

export function SharePanel() {
  const panel = useSyncExternalStore(sharePanel.subscribe, sharePanel.getSnapshot);
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [previewTarget, setPreviewTarget] = useState<SocialTarget>("x");
  const [choosing, setChoosing] = useState(false);
  const [message, setMessage] = useState("");
  const sharing = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setText(panel?.text ?? ""); setImage(null); setChoosing(false); setMessage("");
    if (!panel) return;
    let active = true;
    if (panel.result) void createResultImage(panel.result).then(file => { if (active) setImage(file); }).catch(() => {});
    return () => { active = false; };
  }, [panel]);
  useEffect(() => {
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const overlay = closeButton.current?.closest<HTMLElement>(".share-overlay");
    const hidden: { element: HTMLElement; inert: boolean }[] = [];
    for (let node = overlay; node?.parentElement; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && sibling instanceof HTMLElement) {
          hidden.push({ element: sibling, inert: sibling.inert }); sibling.inert = true;
        }
      }
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const viewport = window.visualViewport;
    const resize = () => {
      overlay?.style.setProperty("--share-height", `${viewport?.height ?? window.innerHeight}px`);
      overlay?.style.setProperty("--share-top", `${viewport?.offsetTop ?? 0}px`);
    };
    window.addEventListener("resize", resize);
    resize(); viewport?.addEventListener("resize", resize); viewport?.addEventListener("scroll", resize);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); sharePanel.close(); }
      if (event.key !== "Tab") return;
      const dialog = closeButton.current?.closest("[role=dialog]");
      const controls = [...dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), textarea, a[href]") ?? []];
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", resize);
      viewport?.removeEventListener("resize", resize); viewport?.removeEventListener("scroll", resize);
      hidden.forEach(({ element, inert }) => { element.inert = inert; });
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [Boolean(panel)]);
  if (!panel) return null;
  const track = (event: "share_target_opened" | "share_link_copied" | "share_native_handoff" | "share_image_saved", channel: string) => recordSharingEvent(event, panel, channel);
  const openTarget = (target: SocialTarget) => {
    window.open(createSocialShareUrl(target, text, panel.url), "_blank", "noopener,noreferrer"); track("share_target_opened", target);
  };
  const copy = async (value: string) => {
    try {
      await copySharedText(value, "share");
      if (sharePanel.getSnapshot() !== panel) return;
      setMessage("コピーしました。");
      track("share_link_copied", "clipboard");
    } catch {
      if (sharePanel.getSnapshot() === panel) setMessage("コピーできませんでした。もう一度お試しください。");
    }
  };
  const share = async () => {
    if (sharing.current) return;
    if (!navigator.share) { setChoosing(true); setMessage("共有先を選んでください。"); return; }
    sharing.current = true; setMessage(""); setChoosing(true);
    try {
      await navigator.share({ text, url: panel.url });
      if (sharePanel.getSnapshot() !== panel) return;
      setMessage("共有先に渡しました。");
      track("share_native_handoff", "native");
    } catch (error) {
      if (sharePanel.getSnapshot() !== panel) return;
      if (error instanceof Error && error.name === "AbortError") setMessage("共有をキャンセルしました。");
      else { setMessage("共有できませんでした。共有先を選ぶか、リンクをコピーしてください。"); setChoosing(true); }
    } finally { sharing.current = false; }
  };
  return <div className="share-overlay" onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    <section className={`share-dialog ${panel.kind === "result" ? "share-result-dialog" : ""}`} role="dialog" aria-modal="true" aria-labelledby="share-title">
      <header className="share-heading"><button ref={closeButton} className="share-close" type="button" onClick={sharePanel.close}>× 閉じる</button>
      <h2 id="share-title">{panel.title}</h2></header>
      <div className="share-body">
      {panel.status === "loading" ? <p role="status">共有URLを準備しています…</p> : panel.status === "error" ? <><p role="alert">結果を保存できませんでした。ゲームはそのまま続けられます。</p><button type="button" onClick={panel.retry}>再試行</button></> : <>
        {panel.result && <div className="share-result-preview" aria-label="公開する結果">
          <ResultCard result={panel.result} playerName={panel.result.playerName} />
          <small>保存済みの結果と表示名はURLを知る人が閲覧できます。リンクカードの画像はゲーム共通です。</small>
        </div>}
        <label htmlFor="share-text">投稿文（編集できます）</label>
        <textarea id="share-text" rows={4} value={text} onChange={event => setText(event.target.value)} />
        {panel.kind === "live" && <p className="share-url">{panel.url}</p>}
        {(panel.kind === "live" || choosing) && <div className="share-alternatives">
        <div className="share-actions">
          <button type="button" onClick={() => openTarget("facebook")}>Facebookで共有</button><button type="button" onClick={() => openTarget("x")}>Xで共有</button>
          <button type="button" onClick={() => void copy(`${text}\n${panel.url}`)}>文章とURLをコピー</button>
          {image && <button type="button" onClick={() => {
            const url = URL.createObjectURL(image); const link = document.createElement("a"); link.href = url; link.download = image.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); track("share_image_saved", "download");
          }}>結果画像を保存</button>}
        </div>
        <small>Facebookの本文は「文章とURLをコピー」から貼り付けてください。画像を直接投稿する場合は、保存した結果画像を添付できます。</small>
        </div>}
        {panel.kind === "live" && <SocialPostPreview panel={panel} text={text} target={previewTarget} onChange={setPreviewTarget} />}
      </>}
      {message && <p role="status">{message}</p>}
      </div>
      {panel.kind === "result" && <footer className="share-footer">
        <button className="share-primary" type="button" disabled={panel.status !== "ready"} onClick={() => void share()}>共有する</button>
        <button type="button" disabled={panel.status !== "ready"} onClick={() => void copy(panel.url)}>リンクをコピー</button>
      </footer>}
    </section>
  </div>;
}
