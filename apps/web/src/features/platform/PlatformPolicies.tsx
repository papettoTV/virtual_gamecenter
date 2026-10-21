import type { Dispatch, SetStateAction } from "react";
import type { PolicyKind } from "./platform-types";
import { BRAND } from "../../domain/brand";
import { openAnalyticsSettings } from "../analytics/AnalyticsConsent";

export interface PlatformPoliciesProps {
  policy: PolicyKind | null;
  setPolicy: Dispatch<SetStateAction<PolicyKind | null>>;
}

export function PlatformPolicies({ policy, setPolicy }: PlatformPoliciesProps) {
  return (
    <>
      {policy && (
        <PolicyDialog kind={policy} onClose={() => setPolicy(null)} />
      )}

      <footer className="platform-footer">
        <strong>{BRAND.name} · {BRAND.category}</strong>
        <button type="button" onClick={() => setPolicy("terms")}>利用規約</button>
        <button type="button" onClick={() => setPolicy("privacy")}>プライバシーポリシー</button>
        <button type="button" onClick={openAnalyticsSettings}>アクセス解析設定</button>
        <a href="/third-party-notices.html" target="_blank" rel="noopener noreferrer">ライセンス</a>
        <a href="https://x.com/pulbase" target="_blank" rel="noopener noreferrer">お問い合わせ：X @pulbase</a>
        <span>特定商取引法に基づく表記は有料化前に公開予定</span>
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
        <iframe
          className="policy-document-frame"
          title={isTerms ? "利用規約全文" : "プライバシーポリシー全文"}
          src={isTerms ? "/legal/terms.html" : "/legal/privacy.html"}
        />
      </article>
    </div>
  );
}
