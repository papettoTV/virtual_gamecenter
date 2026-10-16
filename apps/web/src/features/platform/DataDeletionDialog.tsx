import { useEffect, useState } from "react";
import { PlatformApiError, previewDataDeletion, requestDataDeletion, fetchDataDeletionStatus, type DeletionPreview, type DeletionReceipt } from "./platform-client";
import { notifications } from "../notifications/notifications";

const RECEIPT_KEY = "vgc_deletion_receipt";

export function clearPlatformStorage(): boolean {
  let cleared = true;
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      const storage = window[name];
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      for (const key of keys) if (key && /^(vgc_|pulbase\.|grazeDuel|graze-|buzz-|deep-sea-|dot-wave|mochi-beat)/.test(key)) storage.removeItem(key);
    } catch { cleared = false; }
  }
  return cleared;
}

export function DataDeletionDialog() {
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [receipt, setReceipt] = useState<DeletionReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  const open = async (scope: "all" | "public") => {
    setBusy(true);
    setError("");
    setConfirmed(false);
    try { setPreview(await previewDataDeletion(scope)); }
    catch { notifications.show({ id: "data-deletion", type: "error", message: "削除対象を確認できませんでした。" }); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const listener = (event: Event) => void open((event as CustomEvent).detail === "public" ? "public" : "all");
    const showReceipt = () => {
      try {
        const stored = window.sessionStorage.getItem(RECEIPT_KEY);
        if (stored) setReceipt({ ...JSON.parse(stored) as DeletionReceipt, dismissed: false });
        else notifications.show({ id: "data-deletion", type: "info", message: "このブラウザセッションに削除受付の記録はありません。" });
      } catch { }
    };
    window.addEventListener("request-data-deletion", listener);
    window.addEventListener("request-deletion-status", showReceipt);
    const url = new URL(window.location.href);
    if (url.searchParams.has("deletion")) {
      void open(url.searchParams.get("deletion") === "public" ? "public" : "all");
      url.searchParams.delete("deletion");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    try {
      const stored = window.sessionStorage.getItem(RECEIPT_KEY);
      if (stored) {
        const saved = JSON.parse(stored) as DeletionReceipt;
        if (!saved.dismissed) setReceipt(saved);
      }
    } catch { }
    return () => {
      window.removeEventListener("request-data-deletion", listener);
      window.removeEventListener("request-deletion-status", showReceipt);
    };
  }, []);

  const checkReceipt = async () => {
    if (!receipt) return;
    setBusy(true);
    try {
      const status = await fetchDataDeletionStatus(receipt);
      const updated = { ...receipt, status: status.status };
      setReceipt(updated);
      window.sessionStorage.setItem(RECEIPT_KEY, JSON.stringify(updated));
    } catch { setError("受付状況を確認できませんでした。受付番号を控えてお問い合わせください。"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!preview || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      const result = await requestDataDeletion(preview.confirmationToken);
      setReceipt(result);
      setPreview(null);
      const cleared = result.scope !== "all" || clearPlatformStorage();
      let saved = false;
      try { window.sessionStorage.setItem(RECEIPT_KEY, JSON.stringify(result)); saved = true; }
      catch { }
      if (!cleared || !saved) setError("サーバー側では受付済みですが、このブラウザの保存情報を処理できませんでした。受付番号を控え、必要ならブラウザ設定から保存情報を削除してください。");
      if (result.scope === "all" && cleared && saved) window.location.assign("/");
    } catch (failure) {
      const code = failure instanceof PlatformApiError ? failure.code : "";
      setError(code === "purchase_support_required" ? "購入残高または決済記録があるため、自動退会はできません。X @pulbaseへお問い合わせください。" : code === "reauth_required" ? "本人確認が必要です。再認証してからやり直してください。" : "削除を受け付けられませんでした。対象を確認し直してください。");
    } finally { setBusy(false); }
  };

  if (!preview && !receipt) return null;
  return <div className="platform-overlay platform-overlay-front" role="dialog" aria-modal="true" aria-labelledby="data-deletion-title">
    <section className="platform-dialog platform-dialog-small data-deletion-dialog">
      <button className="platform-dialog-close" type="button" disabled={busy} onClick={() => {
        try { if (receipt) window.sessionStorage.setItem(RECEIPT_KEY, JSON.stringify({ ...receipt, dismissed: true })); }
        catch { }
        setPreview(null); setReceipt(null); setError("");
      }}>× 閉じる</button>
      <h2 id="data-deletion-title">{receipt ? "データ削除の受付" : preview?.scope === "public" ? "公開記録を削除" : preview?.accountRegistered ? "退会・データ削除" : "ゲストデータを削除"}</h2>
      {receipt ? <>
        <p>{receipt.status === "completed" ? "所有者を確認できるアプリ内データの削除が完了しました。" : "削除を受け付けました。処理を再試行します。原則30日以内に完了します。"}</p>
        <p>受付番号：<code>{receipt.id}</code></p>
        <p>特典の受取済み照合情報と最小証跡は所定の期間保持します。バックアップや外部SNSの情報は即時に消えない場合があります。</p>
        <button type="button" disabled={busy} onClick={() => void checkReceipt()}>受付状況を確認</button>
        <button type="button" onClick={() => window.location.assign("/")}>トップページへ</button>
      </> : preview && <>
        <p>対象：<strong>{preview.playerName}</strong></p>
        <p>{preview.scope === "all" ? `無料残高${preview.wallet?.free_balance ?? 0}枚、プロフィール、全端末のログイン、ランキング・共有結果を削除します。取り消せません。` : "あなたのランキング・共有結果を削除します。プロフィールと残高は残ります。取り消せません。"}</p>
        <p>特典の再取得防止情報は最大5年、最小証跡は1年保持します。SNSの投稿・第三者の保存をすべて消すことはできません。</p>
        <p>所有者情報のない旧ランキングは個別確認が必要です。該当する記録は窓口へご相談ください。</p>
        {preview.reauthRequired ? <>
          <p>同じ登録アカウントで本人確認してください。別アカウントでは削除できません。</p>
          <button type="button" disabled={busy} onClick={() => {
            const returnTo = new URL(window.location.href);
            returnTo.searchParams.set("deletion", preview.scope);
            window.location.assign(`/api/platform/auth/reauth?returnTo=${encodeURIComponent(`${returnTo.pathname}${returnTo.search}`)}`);
          }}>再認証して続ける</button>
        </> : <>
          <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />削除対象と取り消せないことを確認しました</label>
          <div className="platform-dialog-actions"><button type="button" disabled={busy} onClick={() => setPreview(null)}>キャンセル</button><button className="platform-danger-button" type="button" disabled={busy || !confirmed} onClick={() => void remove()}>{busy ? "処理中…" : "確認したデータを削除"}</button></div>
        </>}
      </>}
      {error && <p role="alert">{error} <a href="https://x.com/pulbase" target="_blank" rel="noopener noreferrer">お問い合わせ</a></p>}
    </section>
  </div>;
}
