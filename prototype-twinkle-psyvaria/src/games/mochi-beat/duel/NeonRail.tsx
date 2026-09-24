import { BattleIcon } from "./BattleIcon";
import type { CSSProperties } from "react";
import type { Exchange, Grade, Side } from "./core";

const LEFT = 40;
const LENGTH = 920;
// Each side gets a full-width rail: two lead-in beats and four playing beats.
export const railX = (beat: number) => LEFT + (Math.max(-2, Math.min(4, beat)) + 2) / 6 * LENGTH;
export const railGrade = (grade: Grade | null) => grade === "perfect" || grade === "good" ? grade : "pending";

export function railState(exchange: Exchange, seconds: number, requestedOffset?: 4 | 8) {
  const beat = Math.max(0, Math.min(12, seconds / exchange.beatSeconds));
  const offset = requestedOffset ?? (beat < 8 ? 4 : 8);
  const preview = beat < offset;
  return { preview, offset, progress: beat - offset, cursorVisible: beat >= offset - 2, notes: offset === 4 ? exchange.attack.notes : exchange.defense.notes };
}

export function railLanes(exchange: Exchange, seconds: number): (4 | 8)[] {
  const beat = seconds / exchange.beatSeconds;
  return beat < 6 ? [4] : beat < 8 ? [4, 8] : [8];
}

export function NeonRail({ exchange, seconds, viewSide = null }: { exchange: Exchange; seconds: number; viewSide?: Side | null }) {
  return <div className="neon-rail-stack">{railLanes(exchange, seconds).map((offset, index) => {
    const owner = offset === 4 ? exchange.attacker : (1 - exchange.attacker) as Side;
    const own = owner === viewSide;
    const color = owner === 0 ? "#13e5f3" : "#ff39bc";
    return <div key={offset} className={`neon-rail-lane${index === 1 ? " is-incoming" : ""}`} style={{ "--rail-color": color } as CSSProperties}>
      <div className="neon-rail-owner" role="img" aria-label={`${own ? "あなた" : viewSide === null ? owner === 0 ? "シアン" : "ピンク" : "相手"}の${offset === 4 ? "攻撃" : "防御"}${index === 1 ? "、2拍前から準備" : ""}`}>
        <svg viewBox="0 0 32 32" aria-hidden="true" shapeRendering="crispEdges"><path fill="currentColor" d="M12 2h6v4h4v4h4v4h4v10h-4v4H6v-4H2V14h4v-4h6Z"/><path fill="#fff" d="M9 14h4v6H9Zm10 0h4v6h-4Z"/><path stroke="#fff" fill="none" d="M12 23h8"/></svg>
        <BattleIcon kind={offset === 4 ? "note" : "shield"}/>
      </div>
      <RailTrack exchange={exchange} seconds={seconds} offset={offset} incoming={index === 1}/>
    </div>;
  })}</div>;
}

function RailTrack({ exchange, seconds, offset: requestedOffset, incoming = false }: { exchange: Exchange; seconds: number; offset: 4 | 8; incoming?: boolean }) {
  const { preview, offset, progress, cursorVisible, notes } = railState(exchange, seconds, requestedOffset);
  const cursor = railX(progress);
  return <svg className={`neon-rail${preview ? " is-preview" : ""}`} viewBox="0 0 1000 112" role="img" aria-label={preview ? "次のリズム。ひし形と白い光が重なったらタップ" : "白い光が左から右に進むリズムレール。金色はぴったり、薄紫はおしい。長い帯は終点の輪で離す"}>
    <path className="neon-rail-line" d={`M24 56H${incoming ? railX(0) : 976}`} />
    {!incoming && <path className="neon-rail-boundary" d={`M${railX(0)} 28v56`} />}
    {(incoming ? [] : [-2, -1, 0, 1, 2, 3, 4]).map(beat => <path key={beat} className="neon-rail-tick" d={`M${railX(beat)} 87v4`} />)}
    {(incoming ? [] : notes).map(note => {
      const grade = preview ? "pending" : railGrade(note.grade ?? note.holdGrade ?? null);
      return <g key={`${offset}-${note.beat}`} transform={`translate(${railX(note.beat - offset)} 56)`} className={`neon-rail-note ${grade}`}>
        {note.endBeat !== undefined && <g className={`neon-rail-hold${note.holdGrade && note.grade === null ? " is-holding" : ""}`}>
          <rect x="0" y="-9" width={railX(note.endBeat - offset) - railX(note.beat - offset)} height="18" />
          <circle className="neon-rail-release" cx={railX(note.endBeat - offset) - railX(note.beat - offset)} cy="0" r="13" />
          {note.holdGrade && note.grade !== "miss" && <rect className="neon-rail-hold-fill" x="0" y="-9" width={Math.max(0, railX(Math.min(progress, note.endBeat - offset)) - railX(note.beat - offset))} height="18"/>}
        </g>}
        <path className="neon-rail-diamond" d="M0 -14 4 -14 4 -10 10 -4 14 -4 14 4 10 4 4 10 4 14 -4 14 -4 10 -10 4 -14 4 -14 -4 -10 -4 -4 -10 -4 -14Z" />
        {grade === "perfect" && <g className="neon-rail-sparkles"><path d="M-24 -23v10m-5 -5h10M23 12v10m-5 -5h10M19 -24v6m-3 -3h6M-22 18v6m-3 -3h6" /></g>}
        {grade === "good" && <g className="neon-rail-soft-spark"><path d="M-22 0h4M18 0h4" /></g>}
      </g>;
    })}
    {cursorVisible && <g className="neon-rail-cursor" transform={`translate(${cursor} 0)`}>
      {[1, 2, 3, 4].filter(i => cursor - i * 11 >= LEFT).map(i => <rect key={i} x={-i * 11 - 3} y={53} width={5} height={6} opacity={.65 - i * .12} />)}
      <path d="M0 25V87" strokeWidth="14" opacity=".08" />
      <path d="M0 25V87" strokeWidth="7" opacity=".2" />
      <path d="M0 25V87" strokeWidth="3" />
    </g>}
  </svg>;
}
