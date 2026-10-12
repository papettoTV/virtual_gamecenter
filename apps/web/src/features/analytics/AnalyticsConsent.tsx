import { useEffect, useRef, useState, useSyncExternalStore, type Ref } from "react";
import "./analytics-consent.css";

interface AnalyticsSnapshot {
  choice: "accepted" | "rejected" | null;
  persisted: boolean;
  local: boolean;
  active: boolean;
}

declare global {
  interface Window {
    PulbaseAnalytics?: {
      getSnapshot(): AnalyticsSnapshot;
      subscribe(listener: () => void): () => void;
      setChoice(choice: "accepted" | "rejected"): void;
    };
  }
}

const fallback: AnalyticsSnapshot = { choice: null, persisted: false, local: true, active: false };
const getSnapshot = () => window.PulbaseAnalytics?.getSnapshot() ?? fallback;
const subscribe = (listener: () => void) => window.PulbaseAnalytics?.subscribe(listener) ?? (() => {});
export const openAnalyticsSettings = () => window.dispatchEvent(new Event("pulbase:analytics-settings"));

export function AnalyticsConsent() {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => fallback);
  const [visible, setVisible] = useState(() => getSnapshot().choice === null);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const open = () => {
      setVisible(true);
      window.requestAnimationFrame(() => {
        section.current?.scrollIntoView({ block: "start" });
        section.current?.focus({ preventScroll: true });
      });
    };
    window.addEventListener("pulbase:analytics-settings", open);
    return () => window.removeEventListener("pulbase:analytics-settings", open);
  }, []);
  useEffect(() => { if (current.choice === null) setVisible(true); }, [current.choice]);
  const choose = (choice: "accepted" | "rejected") => {
    window.PulbaseAnalytics?.setChoice(choice);
    setVisible(false);
  };
  if (!visible) return null;
  return <AnalyticsConsentView current={current} sectionRef={section} onChoose={choose} onClose={() => setVisible(false)} />;
}

export function AnalyticsConsentView({ current, sectionRef, onChoose, onClose }: {
  current: AnalyticsSnapshot;
  sectionRef?: Ref<HTMLElement>;
  onChoose: (choice: "accepted" | "rejected") => void;
  onClose: () => void;
}) {
  return <section ref={sectionRef} tabIndex={-1} className="analytics-consent" aria-label="アクセス解析の設定">
    <div>
      <strong>Google Analyticsによるアクセス解析</strong>
      <p>利用状況の把握と改善のため、Googleに閲覧情報等を送信してよいですか？拒否してもプレイ・観戦できます。</p>
      <small>選択はこのブラウザに180日間保存します。フッターの「アクセス解析設定」から変更できます。</small>
      <small>現在：{current.choice === "accepted" ? "同意" : current.choice === "rejected" ? "拒否" : "未選択（解析停止中）"}
        {current.local && " · 開発・検証環境では同意しても解析は動作しません。"}</small>
      {!current.persisted && <small>保存できない場合、選択はこのページを開いている間だけ有効です。</small>}
      <a href="/legal/privacy.html" target="_blank" rel="noopener noreferrer">プライバシーポリシー</a>
    </div>
    <div className="analytics-consent-actions">
      <button type="button" onClick={() => onChoose("rejected")}>拒否する</button>
      <button type="button" onClick={() => onChoose("accepted")}>同意する</button>
      <button type="button" className="analytics-consent-close" onClick={onClose}>閉じる</button>
    </div>
  </section>;
}
