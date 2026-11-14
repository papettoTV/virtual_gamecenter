/** Fixed approved artwork, shared by live and result previews. Versioned for SNS caches. */
const images: Readonly<Record<string, { path: string; alt: string }>> = {
  "buzz-barrier": { path: "/social/buzz-barrier-ogp-v2.jpg", alt: "BUZZ BARRIERのボスとシールドが見えるプレイ画面" },
  "dot-wave": { path: "/social/dot-wave-ogp-v2.jpg", alt: "DOT WAVEのプレイ画面" },
  "deep-sea-salvage": { path: "/social/deep-sea-salvage-ogp-v2.jpg", alt: "深海サルベージのプレイ画面" },
};

export function socialImage(gameId: string, origin: string) {
  const image = Object.hasOwn(images, gameId) ? images[gameId]! : null;
  return {
    url: new URL(image?.path ?? "/brand/social-card.png", new URL(origin).origin).href,
    alt: image?.alt ?? "PULBASE ゲームセンター",
    type: image ? "image/jpeg" : "image/png",
    width: 1200, height: 630,
  };
}
