import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "../styles.css";

function redirectLegacyLocalUrl(): boolean {
  if (window.location.protocol === "file:") {
    window.location.replace("http://localhost:5174/");
    return true;
  }

  const { hostname, port, pathname, search } = window.location;
  const isPrivateHost =
    hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname.startsWith("192.168.")
    || hostname.startsWith("10.")
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);

  if (isPrivateHost && port !== "5174") {
    window.location.replace(`http://${hostname}:5174${pathname}${search}`);
    return true;
  }
  return false;
}

if (!redirectLegacyLocalUrl()) {
  const root = document.querySelector("#root");
  if (!root) throw new Error("App root was not found.");
  createRoot(root).render(<App />);
}
