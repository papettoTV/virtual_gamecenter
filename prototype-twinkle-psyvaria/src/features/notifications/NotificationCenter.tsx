import { useSyncExternalStore } from "react";
import { notifications } from "./notifications";
import "./notifications.css";

export function NotificationCenter() {
  const notices = useSyncExternalStore(notifications.subscribe, notifications.getSnapshot);
  return <aside className="notification-center" aria-label="通知">
    {notices.slice(0, 3).map(notice => <div className={`notification notification-${notice.type}`} key={notice.id}>
      <span role={notice.type === "error" ? "alert" : "status"}>{notice.message}</span>
      {notice.action && <button type="button" onClick={() => void notifications.runAction(notice)}>{notice.action.label}</button>}
      <button type="button" aria-label="通知を閉じる" onClick={() => notifications.dismiss(notice.id)}>×</button>
    </div>)}
  </aside>;
}
