import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { liveSharing } from "../sharing/share-service";

// Live play belongs to the browser; SSR and initial hydration use no session.
const getServerSnapshot = () => null;

// Use the same viewport presentation on iOS and browsers with Fullscreen API.
// It does not depend on an asynchronous start retaining user activation.
export function useMobilePlay(screen: RefObject<HTMLElement | null>) {
  const context = useSyncExternalStore(liveSharing.subscribe, liveSharing.getSnapshot, getServerSnapshot);
  const [mobile, setMobile] = useState(false);
  const [active, setActive] = useState(false);
  const dismissed = useRef(false);
  const available = mobile && context?.role === "player" && ["playing", "paused"].includes(context.phase);

  useEffect(() => {
    const query = matchMedia("(max-width: 820px), (pointer: coarse)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!context || context.phase === "ready" || context.phase === "finished") dismissed.current = false;
    if (!available) setActive(false);
    else if (context.phase === "playing" && !dismissed.current) setActive(true);
  }, [available, context]);

  useEffect(() => {
    const root = screen.current;
    if (!active || !root) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const x = window.scrollX, y = window.scrollY;
    const bodyStyle = document.body.getAttribute("style");
    Object.assign(document.body.style, { position: "fixed", top: `-${y}px`, left: `-${x}px`, width: "100%", overflow: "hidden" });
    // Exclude the rest of the page from keyboard and assistive navigation too.
    const siblings: Array<[HTMLElement, boolean]> = [];
    let branch: HTMLElement = root;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          siblings.push([sibling, sibling.inert]); sibling.inert = true;
        }
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    const preventMenu = (event: Event) => event.preventDefault();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismissed.current = true; setActive(false); }
    };
    root.addEventListener("contextmenu", preventMenu);
    document.addEventListener("keydown", escape, true);
    root.querySelector<HTMLButtonElement>(".mobile-play-toggle")?.focus({ preventScroll: true });
    return () => {
      root.removeEventListener("contextmenu", preventMenu);
      document.removeEventListener("keydown", escape, true);
      siblings.forEach(([element, inert]) => { element.inert = inert; });
      if (bodyStyle === null) document.body.removeAttribute("style");
      else document.body.setAttribute("style", bodyStyle);
      window.scrollTo(x, y);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [active, screen]);

  return { active, available, toggle: () => {
    dismissed.current = active;
    setActive(!active);
  } };
}
