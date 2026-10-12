import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import terms from "../../public/legal/terms.html?raw";
import privacy from "../../public/legal/privacy.html?raw";
import { PlatformPolicies, PolicyDialog } from "../../src/features/platform/PlatformPolicies";
import { AnalyticsConsentView } from "../../src/features/analytics/AnalyticsConsent";

describe("free beta legal documents", () => {
  it.each([terms, privacy])("publishes the beta version and the operator's real contact route", document => {
    expect(document).toContain("無料ベータ版");
    expect(document).toContain("2026-10-12");
    expect(document).toContain("papettoTV");
    expect(document).toContain("https://x.com/papettoTV");
    expect(document).not.toContain("プロトタイプ版");
    expect(document).not.toContain("有料化前に正式な運営者情報");
  });

  it("explains the credit floor, public spectating and stopped purchases", () => {
    for (const text of ["初回特典として5枚", "登録特典5枚", "3枚未満なら3枚まで", "仮確保", "新たなクレジット購入を受け付けません", "観戦できます"]) {
      expect(terms).toContain(text);
    }
    expect(terms).toContain("責任を全部免除するものではありません");
  });

  it("discloses stored email, analytics and deletion limitations without inventing retention", () => {
    for (const text of ["メールアドレスも取得・保存", "Google Analytics 4", "閲覧URL", "Cloudflare", "Stripe", "vgc_device", "最大5年", "削除から1年", "ログアウトだけでは"]) {
      expect(privacy).toContain(text);
    }
  });

  it("keeps full documents in the policy dialogs and makes contact available from the footer", () => {
    for (const [kind, path] of [["terms", "/legal/terms.html"], ["privacy", "/legal/privacy.html"]] as const) {
      const markup = renderToStaticMarkup(createElement(PolicyDialog, { kind, onClose: () => {} }));
      expect(markup).toContain("無料ベータ版");
      expect(markup).toContain(`src="${path}"`);
    }
    const footer = renderToStaticMarkup(createElement(PlatformPolicies, { policy: null, setPolicy: () => {} }));
    expect(footer).toContain('href="https://x.com/papettoTV"');
    expect(footer).not.toContain("お問い合わせ（準備中）");
    expect(footer).toContain("アクセス解析設定");
  });

  it("offers optional non-modal analytics choices without blocking games", () => {
    const markup = renderToStaticMarkup(createElement(AnalyticsConsentView, {
      current: { choice: null, persisted: true, local: true, active: false },
      onChoose: () => {}, onClose: () => {},
    }));
    expect(markup).toContain("拒否する");
    expect(markup).toContain("同意する");
    expect(markup).toContain("閉じる");
    expect(markup).toContain("拒否してもプレイ・観戦できます");
    expect(markup).not.toContain('aria-modal="true"');
    expect(markup).not.toContain("disabled");
  });

  it("documents independent analytics consent and withdrawal limitations", () => {
    expect(terms).toContain("2026-10-12.3");
    expect(privacy).toContain("2026-10-12.3");
    expect(privacy).toContain("180日間保存");
    expect(privacy).toContain("Cookieを使わない計測信号も送信しません");
    expect(privacy).toContain("すでに送信済み・送信中");
    expect(terms).toContain("独立した任意の選択");
  });
});
