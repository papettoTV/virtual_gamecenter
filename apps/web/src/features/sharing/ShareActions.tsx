import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SharedResult, SharedResultDraft } from "../../domain/shared-result";
import { resultSharing } from "./result-sharing";
import { liveSharing, shareLive, sharePanel } from "./share-service";
import { presentResult } from "./result-presenters";
import { getResultImageRenderer } from "./result-images";
import { recordSharingEvent } from "./sharing-events";
import { copySharedText } from "../notifications/share";
import { notifications } from "../notifications/notifications";
import "./sharing.css";

export function ResultShareButton({ draft, placement }: { draft?: SharedResultDraft; placement?: string }) {
  const current = useSyncExternalStore(resultSharing.subscribe, resultSharing.getSnapshot);
  if (!draft && !current) return null;
  return <button className="result-share-button" data-placement={placement} type="button" onClick={() => {
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
  return <div className="safe-live-share"><button type="button" onClick={() => void shareLive(context)}>観戦に招待</button></div>;
}

export function ResultCard({ result }: { result: SharedResultDraft }) {
  const presentation = presentResult(result);
  return <section className="shared-result-card" style={{ borderColor: presentation.accent }}>
    <p className="eyebrow">PULBASE / {presentation.title}</p>
    <h2>{presentation.headline}</h2>
    {presentation.details.map(detail => <p key={detail}>{detail}</p>)}
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
  context.fillText(`PULBASE / ${presentation.title}`, 64, 94, 1072);
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
  const [busy, setBusy] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setText(panel?.text ?? ""); setImage(null);
    if (!panel) return;
    let active = true;
    if (panel.result) void createResultImage(panel.result).then(file => { if (active) setImage(file); }).catch(() => {});
    return () => { active = false; };
  }, [panel]);
  useEffect(() => {
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
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
    return () => { document.removeEventListener("keydown", key, true); previous?.focus(); };
  }, [Boolean(panel)]);
  if (!panel) return null;
  const track = (event: "share_target_opened" | "share_link_copied" | "share_native_handoff" | "share_image_saved", channel: string) => recordSharingEvent(event, panel, channel);
  const shareNative = async () => {
    if (!navigator.share) return;
    setBusy(true);
    try {
      const data: ShareData = { title: panel.title, text, url: panel.url };
      if (image && navigator.canShare?.({ files: [image] })) data.files = [image];
      await navigator.share(data);
      track("share_native_handoff", "native");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) notifications.show({ id: "share", type: "error", message: "共有できませんでした。文章とURLをコピーしてお試しください。" });
    } finally { setBusy(false); }
  };
  const openTarget = (target: "x" | "line" | "bluesky") => {
    const message = encodeURIComponent(`${text}\n${panel.url}`);
    const destinations = { x: `https://twitter.com/intent/tweet?text=${message}`, line: `https://line.me/R/msg/text/?${message}`, bluesky: `https://bsky.app/intent/compose?text=${message}` };
    window.open(destinations[target], "_blank", "noopener,noreferrer"); track("share_target_opened", target);
  };
  return <div className="share-overlay" onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    <section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <button ref={closeButton} className="share-close" type="button" onClick={sharePanel.close}>× 閉じる</button>
      <h2 id="share-title">{panel.title}</h2>
      {panel.kind === "result" && <small>結果と表示名を公開します。URLを知っている人が閲覧できます。</small>}
      {panel.status === "loading" ? <p role="status">共有URLを準備しています…</p> : panel.status === "error" ? <><p role="alert">結果を保存できませんでした。ゲームはそのまま続けられます。</p><button type="button" onClick={panel.retry}>再試行</button></> : <>
        {panel.result && <ResultCard result={panel.result} />}
        <label htmlFor="share-text">投稿文（編集できます）</label>
        <textarea id="share-text" rows={4} value={text} onChange={event => setText(event.target.value)} />
        <p className="share-url">{panel.url}</p>
        <div className="share-actions">
          {typeof navigator.share === "function" && <button type="button" disabled={busy} onClick={() => void shareNative()}>端末の共有メニュー</button>}
          <button type="button" onClick={() => openTarget("x")}>X</button><button type="button" onClick={() => openTarget("line")}>LINE</button><button type="button" onClick={() => openTarget("bluesky")}>Bluesky</button>
          <button type="button" onClick={() => void copySharedText(`${text}\n${panel.url}`, "share").then(() => track("share_link_copied", "clipboard")).catch(() => {})}>文章とURLをコピー</button>
          {image && <button type="button" onClick={() => {
            const url = URL.createObjectURL(image); const link = document.createElement("a"); link.href = url; link.download = image.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); track("share_image_saved", "download");
          }}>結果画像を保存</button>}
        </div>
        {panel.result && <small>結果URLからいつでも確認できます。X等への投稿画像は、保存した画像を添付できます。</small>}
      </>}
    </section>
  </div>;
}
