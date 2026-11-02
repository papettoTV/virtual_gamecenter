import { socialImage } from "../shared/social-image";

export { socialImage } from "../shared/social-image";

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
