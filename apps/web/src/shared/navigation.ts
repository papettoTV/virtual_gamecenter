export function navigate(destination: string) {
  history.pushState({}, "", destination);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
