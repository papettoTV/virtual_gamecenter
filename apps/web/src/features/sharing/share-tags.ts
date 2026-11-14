const gameTags: Readonly<Record<string, string>> = {
  "buzz-barrier": "#バズバリア #BUZZBRRIER",
  "dot-wave": "#ドットウェーブ #DOTWAVE",
  "deep-sea-salvage": "#深海サルベージ #DEEPSEASALVAGE",
};

export function shareTags(gameId: string): string {
  const tags = Object.hasOwn(gameTags, gameId) ? gameTags[gameId] : undefined;
  return tags ? `${tags} #PULBASE` : "#PULBASE";
}
