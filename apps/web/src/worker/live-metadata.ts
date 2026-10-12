import { getGameDefinition } from "../domain/game";

function escape(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function rewriteLivePage(shell: Response, url: URL): Response {
  const game = getGameDefinition(url.searchParams.get("game"));
  if (!game) return shell;
  const canonical = new URL(url.pathname, url.origin);
  canonical.searchParams.set("game", game.id); canonical.searchParams.set("watch", "1");
  const image = new URL(`/share/live/${encodeURIComponent(game.id)}/image.png`, url.origin);
  const title = `${game.title}の観戦 | PULBASE`;
  const description = "この筐体のプレイを観戦できます。開始前・終了後は筐体の状況をご案内します。";
  const metadata = `<title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${escape(canonical.href)}"><meta property="og:image" content="${escape(image.href)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${escape(image.href)}">`;
  const headers = new Headers(shell.headers);
  for (const key of ["content-length", "etag", "last-modified", "content-encoding"]) headers.delete(key);
  headers.set("Cache-Control", "no-store");
  return new HTMLRewriter()
    .on('title, meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]', { element(element) { element.remove(); } })
    .on("head", { element(element) { element.append(metadata, { html: true }); } })
    .transform(new Response(shell.body, { status: shell.status, headers }));
}
