import { navigate } from "../../shared/navigation";

export function CabinetReturnLink({ id }: { id?: string }) {
  return <a id={id} className="cabinet-return-link" href="/" onClickCapture={event => {
    event.stopPropagation();
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate("/");
  }}>‹ ゲーム一覧へ</a>;
}
