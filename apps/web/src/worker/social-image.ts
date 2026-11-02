/** Fixed approved artwork, shared by live and result previews. Versioned for SNS caches. */
const images: Readonly<Record<string, { path: string; alt: string }>> = {
  "graze-duel": { path: "/social/buzz-barrier-ogp-v2.jpg", alt: "BUZZ BARRIERのボスとシールドが見えるプレイ画面" },
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

export function socialImageMetadata(gameId: string, origin: string): string {
  const image = socialImage(gameId, origin);
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  return `<meta property="og:image" content="${escape(image.url)}">
<meta property="og:image:type" content="${image.type}">
<meta property="og:image:width" content="${image.width}">
<meta property="og:image:height" content="${image.height}">
<meta property="og:image:alt" content="${escape(image.alt)}">
<meta name="twitter:image" content="${escape(image.url)}">
<meta name="twitter:image:alt" content="${escape(image.alt)}">`;
}
