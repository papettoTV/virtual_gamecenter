export function navigate(destination: string, options: { replace?: boolean } = {}) {
  if (options.replace) history.replaceState({}, "", destination);
  else history.pushState({}, "", destination);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
