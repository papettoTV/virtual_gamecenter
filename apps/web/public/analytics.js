(() => {
  if (window.PulbaseAnalytics) return;
  const key = "pulbase.analytics-consent.v1";
  const measurementId = "G-0SLPCHD77R";
  const lifetime = 180 * 86400000;
  const listeners = new Set();
  let preference = null;
  let persisted = true;
  let initialized = false;
  let expiryTimer;
  let snapshot;
  const hostname = window.location.hostname.toLowerCase().replace(/\.$/, "");
  const isLocal = window.location.protocol === "file:"
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "[::1]"
    || hostname === "::1"
    || /^127\./.test(hostname)
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  const eligible = () => preference?.choice === "accepted"
    && preference.updatedAt + lifetime > Date.now() && !isLocal && window.top === window;
  const read = () => {
    try {
      const value = JSON.parse(window.localStorage.getItem(key) || "null");
      preference = value?.version === 1 && ["accepted", "rejected"].includes(value.choice)
        && Number.isFinite(value.updatedAt) && value.updatedAt <= Date.now()
        && value.updatedAt + lifetime > Date.now() ? value : null;
      persisted = true;
    } catch { preference = null; persisted = false; }
  };
  const pageView = () => {
    if (!eligible() || !initialized) return;
    const pathname = window.location.pathname;
    const path = /^\/cabinets\/[^/]+$/.test(pathname) ? "/cabinets/live"
      : /^\/results\/[^/]+$/.test(pathname) ? "/results/shared"
      : ["/", "/legal/terms.html", "/legal/privacy.html"].includes(pathname) ? pathname : "/other";
    window.gtag("event", "page_view", {
      page_location: window.location.origin + path, page_referrer: "", page_title: "PULBASE",
    });
  };
  const clearCookies = () => {
    try {
      for (const cookie of document.cookie.split(";")) {
        const name = cookie.trim().split("=")[0];
        if (!/^_ga(?:_|$)/.test(name)) continue;
        const expired = `${name}=; Max-Age=0; path=/`;
        document.cookie = expired;
        const parts = hostname.split(".");
        for (let index = 0; index < parts.length - 1; index++) {
          document.cookie = `${expired}; domain=${parts.slice(index).join(".")}`;
          document.cookie = `${expired}; domain=.${parts.slice(index).join(".")}`;
        }
      }
    } catch {}
  };
  const apply = () => {
    if (preference && preference.updatedAt + lifetime <= Date.now()) preference = null;
    const active = eligible();
    window[`ga-disable-${measurementId}`] = !active;
    if (!active) {
      if (window.dataLayer) window.dataLayer.length = 0;
      if (preference?.choice !== "accepted") clearCookies();
    } else if (!snapshot?.active) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { if (eligible()) window.dataLayer.push(arguments); };
      window.gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
      window.gtag("js", new Date());
      window.gtag("config", measurementId, {
        send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
        cookie_domain: "none", cookie_expires: lifetime / 1000, cookie_update: false,
        page_location: window.location.origin + "/", page_referrer: "", page_title: "PULBASE",
      });
      if (!initialized) {
        initialized = true;
        const script = document.createElement("script");
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
        script.onerror = () => { initialized = false; };
        document.head.appendChild(script);
      }
    }
    window.clearTimeout(expiryTimer);
    if (preference) expiryTimer = window.setTimeout(apply, Math.min(preference.updatedAt + lifetime - Date.now(), 2147483647));
    snapshot = Object.freeze({ choice: preference?.choice ?? null, persisted, local: isLocal, active });
    for (const listener of listeners) listener();
  };
  window.PulbaseAnalytics = Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setChoice(choice) {
      if (!["accepted", "rejected"].includes(choice)) return;
      preference = { version: 1, choice, updatedAt: Date.now() };
      try { window.localStorage.setItem(key, JSON.stringify(preference)); persisted = true; }
      catch { persisted = false; }
      apply();
      pageView();
    },
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) { read(); apply(); }
  });
  window.addEventListener("popstate", () => { apply(); pageView(); });
  window.addEventListener("pageshow", apply);
  read();
  apply();
  pageView();
})();
