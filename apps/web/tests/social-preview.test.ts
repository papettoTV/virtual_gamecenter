import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { socialImage } from "../src/shared/social-image";
import { socialImage as workerSocialImage } from "../src/worker/social-image";
import { SocialPostPreview } from "../src/features/sharing/SocialPostPreview";
import type { SharePanelState } from "../src/features/sharing/share-service";

beforeEach(() => vi.stubGlobal("location", { origin: "http://localhost:5174" }));
afterEach(() => vi.unstubAllGlobals());

const panel: SharePanelState = {
  kind: "result", gameId: "graze-duel", targetId: "saved-result", shareId: "share", title: "結果を共有", text: "text",
  url: "http://localhost:5174/results/saved-result", status: "ready",
  result: { id: "saved-result", gameId: "graze-duel", gameVersion: "test-1", elapsedTimeMs: 15000, cleared: false, score: 1200, metrics: { maxLevel: 3, defeatedBossCount: 0 }, playerName: "Player-test", createdAt: "2026-10-12T00:00:00Z" },
};

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}
function copy(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(copy).join(" ");
  if (typeof node === "string") return node;
  if (node && typeof node === "object" && "props" in node) return copy((node as ReactElement<{ children: ReactNode }>).props.children);
  return "";
}

it.each(["facebook", "x"] as const)("uses saved metadata, edits and actual OGP image for the %s reference preview", target => {
  const tree = SocialPostPreview({ panel, text: "編集した本文", target, onChange: vi.fn() });
  const image = elements(tree).find(element => element.type === "img");
  expect(image?.props.src).toBe("http://localhost:5174/social/buzz-barrier-ogp-v2.jpg");
  expect(copy(tree)).toContain("編集した本文");
  expect(copy(tree)).toContain("実際のSNSのレイアウトやカード表示とは異なる");
  expect(copy(tree).includes("本文を貼り付けた場合")).toBe(target === "facebook");
  expect(copy(tree)).toContain("BUZZ BARRIER | 今回の挑戦 | PULBASE");
});

it("previews a live invitation with its own image rather than a result card", () => {
  const tree = SocialPostPreview({ panel: { ...panel, kind: "live", gameId: "dot-wave", result: undefined, url: "http://localhost:5174/cabinets/test?game=dot-wave&watch=1" }, text: "観戦に招待", target: "x", onChange: vi.fn() });
  const image = elements(tree).find(element => element.type === "img");
  expect(image?.props.src).toBe("http://localhost:5174/social/dot-wave-ogp-v2.jpg");
  expect(copy(tree)).toContain("DOT WAVEの観戦");
});

it.each(["graze-duel", "dot-wave", "deep-sea-salvage", "unknown", "__proto__", "constructor"])("shares Worker artwork and metadata for live/result %s on the share origin", gameId => {
  expect(workerSocialImage).toBe(socialImage);
  for (const origin of ["https://develop.virtual-gamecenter.pages.dev", "https://example.test:8443"]) {
    for (const kind of ["live", "result"] as const) {
      for (const target of ["x", "facebook"] as const) {
        const url = `${origin}/${kind === "live" ? "cabinets" : "results"}/saved?ref=share&shareId=test`;
        const state = { ...panel, kind, gameId, url, result: kind === "result" ? { ...panel.result!, gameId } : undefined };
        const tree = SocialPostPreview({ panel: state, text: "編集した本文", target, onChange: vi.fn() });
        const image = elements(tree).find(element => element.type === "img");
        const expected = socialImage(gameId, url);
        expect(image?.props).toMatchObject({ src: expected.url, alt: expected.alt, width: expected.width, height: expected.height });
        expect(new URL(String(image?.props.src)).origin).toBe(origin);
        expect(copy(tree)).toContain("編集した本文");
        if (target === "x") expect(copy(tree)).toContain(url);
      }
    }
  }
});
