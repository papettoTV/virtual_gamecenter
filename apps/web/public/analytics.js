(() => {
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
  if (isLocal) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", "G-0SLPCHD77R");

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=G-0SLPCHD77R";
  document.head.appendChild(script);
})();
