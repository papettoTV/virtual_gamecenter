export function getPausePresentation(frame) {
  if (frame.cabinetRole === "spectator") {
    return {
      action: frame.waitingForStart ? "プレイヤーの開始を待っています" : "プレイヤーの再開を待っています",
      instructions: [],
    };
  }
  return {
    action: frame.compact
      ? frame.waitingForStart ? "ゲーム領域をタップしてゲーム開始" : "中央の「▶ 再開」か右上の「▶」をタップ"
      : frame.waitingForStart ? "Spaceでゲーム開始" : "「▶ 再開」またはSpaceで再開",
    instructions: frame.compact
      ? ["移動: ゲーム画面をスライド", "ボス攻撃: 無敵シールドを当てる"]
      : ["移動: 矢印キー / WASD", "低速移動: Shift", "ボス攻撃: 無敵シールドを当てる"],
  };
}
