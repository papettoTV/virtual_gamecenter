import { notifications } from "./notifications";

export async function copySharedText(text: string, id: string, scope?: string) {
  const isActive = notifications.captureScope(scope);
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(text);
    else {
      const field = document.createElement("textarea");
      field.value = text;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      try {
        field.select();
        if (!document.execCommand("copy")) throw new Error("copy_failed");
      } finally { field.remove(); }
    }
    if (isActive()) notifications.show({ id, scope, type: "success", message: "コピーしました。" });
  } catch (error) {
    if (isActive()) notifications.show({ id, scope, type: "error", message: "コピーできませんでした。", action: { label: "再試行", run: () => copySharedText(text, id, scope) } });
    throw error;
  }
}
