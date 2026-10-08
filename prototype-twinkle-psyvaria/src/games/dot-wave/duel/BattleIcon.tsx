export type BattleIconKind = "tap" | "wait" | "note" | "shield" | "sound" | "sound-off";

// Shared shapes keep the character's turn cue and the input button recognizable.
export function BattleIcon({ kind }: { kind: BattleIconKind }) {
  return <svg className="dot-battle-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="miter" aria-hidden="true">
    {kind === "tap" && <><path d="M13 18V9a3 3 0 0 1 6 0v7l5 1v9l-4 4h-8l-7-9 4-3 4 4"/><path d="M3 11H0M7 5 4 2M25 5l3-3M29 11h3"/></>}
    {kind === "wait" && <><path d="M8 17V9a2 2 0 0 1 4 0v8-12a2 2 0 0 1 4 0v12-11a2 2 0 0 1 4 0v11-8a2 2 0 0 1 4 0v15l-5 6h-9l-7-11 3-3 2 3"/></>}
    {kind === "note" && <><path d="M14 23V5l13 3v6l-13-3"/><path d="M14 23c0 7-11 8-11 2 0-5 11-7 11-2Z" fill="currentColor"/></>}
    {kind === "shield" && <path d="m16 3 12 4v11l-4 6-8 6-8-6-4-6V7Z"/>}
    {kind === "sound-off" && <><path d="M3 12h6l8-7v22l-8-7H3Z"/><path d="M3 3 29 29" strokeWidth="3"/></>}
    {kind === "sound" && <><path d="M3 12h6l8-7v22l-8-7H3Z"/><path d="M22 10q7 6 0 12M26 5q11 11 0 22"/></>}
  </svg>;
}
