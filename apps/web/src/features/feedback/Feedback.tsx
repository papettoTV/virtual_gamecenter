import { useEffect, useRef, useState } from "react";
import { getGameDefinition } from "../../domain/game";
import { createUuid } from "../../shared/id";
import { liveSharing } from "../sharing/share-service";
import { notifications } from "../notifications/notifications";
import { canPrompt, FEEDBACK_HISTORY_KEY, FEEDBACK_RETURN_KEY, FeedbackVisit, japanDay, readHistory, takeReturn, type FeedbackContext } from "./prompt-policy";
import "./feedback.css";

export function openFeedback() { window.dispatchEvent(new Event("pulbase-open-feedback")); }

export function Feedback({ address }: { address: string }) {
  const visit = useRef(new FeedbackVisit());
  const dialog = useRef<HTMLDialogElement>(null);
  const [context, setContext] = useState<FeedbackContext>({ gameId: null, activity: "site" });
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const submission = useRef<string | null>(null);
  const payloadKey = useRef("");
  const returned = useRef<FeedbackContext | null>(null);
  const manualOpened = useRef(false);

  useEffect(() => {
    try { returned.current = takeReturn(sessionStorage, Date.now()); } catch {}
    const update = () => visit.current.live(liveSharing.getSnapshot(), Date.now(), document.visibilityState === "visible");
    const manual = () => {
      if (dialog.current?.open) return;
      manualOpened.current = true;
      setContext(visit.current.current); setError(""); dialog.current?.showModal();
    };
    const unsubscribe = liveSharing.subscribe(update);
    const leaving = () => {
      const candidate = visit.current.leaving(Date.now());
      try { if (candidate) sessionStorage.setItem(FEEDBACK_RETURN_KEY, JSON.stringify({ ...candidate, at: Date.now() })); } catch {}
    };
    window.addEventListener("pagehide", leaving);
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pulbase-open-feedback", manual);
    update();
    return () => { unsubscribe(); window.removeEventListener("pagehide", leaving); window.removeEventListener("pageshow", update); document.removeEventListener("visibilitychange", update); window.removeEventListener("pulbase-open-feedback", manual); };
  }, []);

  useEffect(() => {
    dialog.current?.close();
    manualOpened.current = false;
    const url = new URL(address, location.origin);
    const recovered = url.pathname === "/" && !url.searchParams.has("game") ? returned.current : null;
    returned.current = null;
    const candidate = visit.current.route(address, Date.now()) ?? recovered;
    if (!candidate) return;
    const timer = window.setInterval(() => {
      if (manualOpened.current) { clearInterval(timer); return; }
      if (document.visibilityState !== "visible" || sending.current || dialog.current?.open) return;
      const occupied = [...document.querySelectorAll<HTMLElement>('dialog[open], [aria-modal="true"], .platform-overlay')]
        .some(element => element.getClientRects().length > 0);
      if (occupied) return;
      try {
        const history = readHistory(localStorage);
        if (!history || !canPrompt(history, Date.now(), candidate.activity)) { clearInterval(timer); return; }
        localStorage.setItem(FEEDBACK_HISTORY_KEY, JSON.stringify({ ...history, lastDay: japanDay(Date.now()), playPrompted: history.playPrompted || candidate.activity === "player" }));
        setContext(candidate); setError(""); dialog.current?.showModal(); clearInterval(timer);
      } catch { clearInterval(timer); }
    }, 1000);
    return () => clearInterval(timer);
  }, [address]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true; setPending(true); setError("");
    let failureMessage = "送信できませんでした。内容は残っています。もう一度お試しください。";
    try {
      const key = JSON.stringify({ category, message: message.trim(), ...context });
      if (key !== payloadKey.current || !submission.current) { submission.current = createUuid(); payloadKey.current = key; }
      const response = await fetch("/api/feedback", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: submission.current, category, message: message.trim(), ...context }), signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        if (response.status === 429) failureMessage = "しばらく時間をおいてから送ってください。";
        throw new Error("feedback_failed");
      }
      try { localStorage.setItem(FEEDBACK_HISTORY_KEY, JSON.stringify({ ...(readHistory(localStorage) ?? {}), submittedAt: Date.now() })); } catch {}
      setMessage(""); setCategory(""); submission.current = null; dialog.current?.close();
      notifications.show({ id: "feedback-sent", type: "success", message: "フィードバックをありがとうございました。" });
    } catch {
      setError(failureMessage);
    } finally { sending.current = false; setPending(false); }
  }

  const title = context.gameId ? getGameDefinition(context.gameId)?.title ?? "サイト全体" : "サイト全体";
  return <dialog ref={dialog} className="feedback-dialog" aria-labelledby="feedback-title" onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
    <form onSubmit={event => void send(event)}>
      <header><h2 id="feedback-title">感想・不具合を送る</h2><button type="button" aria-label="フィードバックを閉じる" onClick={() => dialog.current?.close()}>✕ 閉じる</button></header>
      <p>気づいたことを教えてください。登録・メールアドレスは不要です。</p>
      <fieldset disabled={pending}><legend>どのような内容ですか？</legend>
        {[["good", "よかった"], ["concern", "気になった"], ["bug", "不具合"]].map(([value, label]) => <label key={value}><input type="radio" name="feedback-category" value={value} required checked={category === value} onChange={() => setCategory(value!)} />{label}</label>)}
      </fieldset>
      <div className="feedback-message"><label htmlFor="feedback-message">内容</label><textarea id="feedback-message" required minLength={1} maxLength={2000} rows={5} value={message} disabled={pending} onChange={event => setMessage(event.target.value)} /></div>
      <p className="feedback-details">一緒に送る情報：{title} ／ {context.activity === "player" ? "プレイ" : context.activity === "spectator" ? "観戦" : "サイト利用"}</p>
      <p className="feedback-details">現在のプレイヤー名・端末種別（PC/スマホ等）・ブラウザ種別も運営者向けに記録します。ブラウザのバージョンや端末の詳しい情報は保存しません。</p>
      <p className="feedback-details">本文は非公開で90日保存します。パスワード・連絡先などの個人情報は書かないでください。返信機能はありません。</p>
      {error && <p role="alert">{error}</p>}
      <button className="feedback-send" disabled={pending || !category || !message.trim()} type="submit">{pending ? "送信中…" : "送る"}</button>
    </form>
  </dialog>;
}
