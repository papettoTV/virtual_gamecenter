import type { DotWaveRoster } from '../../../domain/cabinet';

export function crownTier(wins: number) { return wins >= 5 ? 3 : wins >= 3 ? 2 : wins >= 1 ? 1 : 0; }
export function PlayerRoster({players, entrance = false}: {players: DotWaveRoster; entrance?: boolean}) {
 return <div className={`dot-player-roster${entrance ? ' is-entering' : ''}`}>
  {players.map((player,side) => <div key={side} className={`dot-player-nameplate side-${side}`}>
   {player && <>
    <div key={`${player.name}-${player.wins}`} className={`dot-champion tier-${crownTier(player.wins)}`}>
     {player.wins > 0 && <><svg viewBox="0 0 48 32" role="img" aria-label="チャンピオンの王冠" shapeRendering="crispEdges">
      <path d="M4 10h4v4h4v4h4v-8h4V4h8v6h4v8h4v-4h4v-4h4v16H4Z" fill="currentColor"/>
      <path d="M4 28h40v4H4Z" fill="currentColor"/><path d="M22 16h4v6h-4Z" fill="#090d20"/>
      {player.wins>=3&&<path d="M0 0h4v4H0Zm44 0h4v4h-4Z" fill="#fff1af"/>}
      {player.wins>=5&&<path d="M0 20h4v4H0Zm44 0h4v4h-4ZM10 2h4v4h-4Zm24 0h4v4h-4Z" fill="#fff"/>}
     </svg><span>{player.wins}<small>連勝</small></span></>}
    </div>
    <strong title={player.name}>{player.name}</strong>
   </>}
  </div>)}
 </div>;
}
