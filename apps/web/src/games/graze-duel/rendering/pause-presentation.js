export function getPausePresentation(frame) {
  if (frame.cabinetRole === "spectator") {
    return {
      action: frame.waitingForStart ? "プレイヤーの開始を待っています" : "プレイヤーの再開を待っています",
      instructions: [],
    };
  }
  return {
    action: frame.compact
      ? frame.waitingForStart ? "画面下の「ゲーム開始」でスタート" : "画面下の「再開」ボタンでゲーム再開"
      : frame.waitingForStart ? "Spaceでゲーム開始" : "Spaceで再開",
    instructions: frame.compact
      ? ["移動: ゲーム画面をスライド", "ボス攻撃: 無敵シールドを当てる"]
      : ["移動: 矢印キー / WASD", "低速移動: Shift", "ボス攻撃: 無敵シールドを当てる"],
  };
}
