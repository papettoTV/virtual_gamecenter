export type SocialTarget = "facebook" | "x";

export const SOCIAL_TARGETS: readonly SocialTarget[] = ["facebook", "x"];

export function createSocialShareUrl(target: SocialTarget, text: string, shareUrl: string): string {
  const destination = new URL(target === "facebook" ? "https://www.facebook.com/sharer/sharer.php" : "https://x.com/intent/tweet");
  if (target === "facebook") destination.searchParams.set("u", shareUrl);
  else {
    destination.searchParams.set("text", text);
    destination.searchParams.set("url", shareUrl);
  }
  return destination.toString();
}
