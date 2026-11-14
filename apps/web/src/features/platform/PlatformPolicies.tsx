import { useState, type Dispatch, type SetStateAction } from "react";
import type { PolicyKind } from "./platform-types";
import { BRAND } from "../../domain/brand";
import { openAnalyticsSettings } from "../analytics/AnalyticsConsent";
import { openFeedback } from "../feedback/Feedback";
import "./platform-policies.css";

interface BetaFooterProps {
  showBetaMessage?: boolean;
  showBetaBadge?: boolean;
}

export interface PlatformPoliciesProps extends BetaFooterProps {
  policy: PolicyKind | null;
  setPolicy: Dispatch<SetStateAction<PolicyKind | null>>;
}

export function SiteFooter({ showBetaMessage, showBetaBadge }: BetaFooterProps) {
  const [policy, setPolicy] = useState<PolicyKind | null>(null);
  return <PlatformPolicies policy={policy} setPolicy={setPolicy} showBetaMessage={showBetaMessage} showBetaBadge={showBetaBadge} />;
}

export function PlatformPolicies({ policy, setPolicy, showBetaMessage, showBetaBadge }: PlatformPoliciesProps) {
  return (
    <>
      {policy && (
        <PolicyDialog kind={policy} onClose={() => setPolicy(null)} />
      )}

      <footer className="platform-footer">
        {showBetaMessage && <div className="platform-beta-note">
          <p>PULBASEは無料ベータ版です。遊んでみた感想や、気になったことをぜひお聞かせください。</p>
          <button type="button" onClick={openFeedback}>ご意見・感想を送る</button>
        </div>}
        <strong className="platform-footer-brand">{BRAND.name} · {BRAND.category}{showBetaBadge && <span className="brand-beta-badge">{BRAND.betaLabel}</span>}</strong>
        <button type="button" onClick={() => setPolicy("terms")}>利用規約</button>
        <button type="button" onClick={() => setPolicy("privacy")}>プライバシーポリシー</button>
        {!showBetaMessage && <button type="button" onClick={openFeedback}>ご意見・感想を送る</button>}
        <a href="/third-party-notices.html" target="_blank" rel="noopener noreferrer">ライセンス</a>
        <a href="https://x.com/pulbase" target="_blank" rel="noopener noreferrer">お問い合わせ：X @pulbase</a>
      </footer>
    </>
  );
}

export interface PolicyDialogProps {
  kind: PolicyKind;
  onClose: () => void;
}

export function PolicyDialog({ kind, onClose }: PolicyDialogProps) {
  const isTerms = kind === "terms";
  return (
    <div className="platform-overlay platform-overlay-front" role="dialog" aria-modal="true">
      <article className="platform-dialog policy-dialog">
        <button className="platform-dialog-close" type="button" aria-label="閉じる" onClick={onClose}>
          × 閉じる
        </button>
        <h2>{isTerms ? "利用規約（無料ベータ版）" : "プライバシーポリシー（無料ベータ版）"}</h2>
        {!isTerms && <button type="button" onClick={() => { onClose(); openAnalyticsSettings(); }}>アクセス解析設定</button>}
        <iframe
          className="policy-document-frame"
          title={isTerms ? "利用規約全文" : "プライバシーポリシー全文"}
          src={isTerms ? "/legal/terms.html" : "/legal/privacy.html"}
        />
      </article>
    </div>
  );
}
