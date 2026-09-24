import { turnCue, cueName } from "./turnCue";
import { BattleIcon } from "./BattleIcon";
import { memo } from "react";
import { BEAT, levelAt, quality, type Side } from "./core";
import type { Engine } from "./MochiDuel";

const CYAN = "#13e5f3", PINK = "#ff39bc", LIME = "#baff39";
const NOTE = ["00011000", "00011110", "00011011", "00011001", "00011000", "01111000", "11111000", "01110000"];
const BODY = ["00000011000000000", "00000111000000000", "00000011100000000", "00001111111000000", "00111111111110000", "01111111111111000", "01111111111111100", "11111111111111100", "11111111111111110", "11111111111111111", "11111111111111100", "01111111111111100", "00111111111111000", "00011111111110000", "00001111111100000", "00011000001100000"];
const LETTERS: Record<string, string[]> = {
 D:["11110","10001","10001","10001","10001","10001","11110"], O:["01110","10001","10001","10001","10001","10001","01110"], T:["11111","00100","00100","00100","00100","00100","00100"],
 W:["10001","10001","10001","10101","10101","10101","01010"], A:["01110","10001","10001","11111","10001","10001","10001"], V:["10001","10001","10001","10001","10001","01010","00100"], E:["11111","10000","10000","11110","10000","10000","11111"],
};
export function PixelWord() {
 return <svg viewBox="0 0 240 35" role="img" aria-label="DOT WAVE" className="dot-word" shapeRendering="crispEdges">{[..."DOT WAVE"].map((letter,index) => <Pixels key={index} rows={LETTERS[letter] ?? []} x={index*30} y={0} size={5} color={index<3?CYAN:PINK}/>)}</svg>;
}
function Pixels({rows,x,y,size=6,color}:{rows:readonly string[];x:number;y:number;size?:number;color:string}) {
 return <g>{rows.flatMap((row,j)=>[...row].map((cell,i)=>cell==='0'?null:<rect key={`${j}-${i}`} x={x+i*size} y={y+j*size} width={size-1} height={size-1} fill={color}/>))}</g>;
}
// Head and tail move at the same speed; the tail arrives after the hold duration.
export function cometMotion(travel: number, duration: number) {
 const head=Math.max(0,Math.min(1,travel));
 const tail=Math.max(0,Math.min(1,travel-duration));
 return {head,length:Math.max(0,head-tail)*408};
}
function NoteComet({x,length,side,color,size=5}:{x:number;length:number;side:Side;color:string;size?:number}) {
 const columns=Math.floor(length/6);
 return <g className="dot-note-comet" aria-label="長押しの長い音符" transform={`translate(${Math.round(x/6)*6} 228) scale(${side===0?1:-1} 1)`}>
  {Array.from({length:columns},(_,i)=>{
   const half=i>columns-5?0:i>columns-10?1:2;
   return <g key={i}>{Array.from({length:half*2+1},(_,j)=><rect x={-i*6-6} y={(j-half)*6-2} width="5" height="5" fill={j===half?"#e7ffff":color} opacity={j===half?1:.65}/>)}</g>;
  })}
  <Pixels rows={NOTE} x={-12} y={-24} size={size} color={color}/>
 </g>;
}
function Ring({x,y,r,color}:{x:number;y:number;r:number;color:string}) {
 const cells=[];
 for(let j=-r;j<=r;j++) for(let i=-r;i<=r;i++) { const d=Math.hypot(i,j); if(d>r-1.1&&d<=r) cells.push(<rect key={`${i}-${j}`} x={x+i*6} y={y+j*6} width="5" height="5" fill={color}/>); }
 return <g>{cells}</g>;
}
const Backdrop=memo(function Backdrop(){
 return <g>
  <rect width="960" height="360" fill="#07091a"/>
  {[0,1].map(side=><g key={side} transform={side?"translate(960 0) scale(-1 1)":undefined}>
   {Array.from({length:28},(_,i)=><rect key={i} x={12+i*6} y={48+Math.floor(i/2)*6} width="5" height="5" fill="#3d167c"/>)}
   {[102,204].map(y=><g key={y}><Ring x={30} y={y} r={8} color="#372167"/><Ring x={30} y={y} r={4} color="#552795"/>{Array.from({length:16},(_,i)=><rect key={i} x="90" y={y-48+i*6} width="5" height="5" fill={i%4===0?LIME:"#252347"}/>)}</g>)}
  </g>)}
  {Array.from({length:80},(_,i)=><rect key={i} x={i*12} y="312" width="8" height="3" fill={i%5===0?"#749727":"#332269"}/>)}
  {Array.from({length:7},(_,row)=><g key={row}>{Array.from({length:48},(_,col)=><rect key={col} x={col*20+(row%2)*10} y={322+row*5} width="9" height="2" fill="#281a50"/>)}</g>)}
 </g>;
});

export function DotScene({engine:e,viewSide=0}:{engine:Engine;viewSide?:Side|null}) {
 const beat=Math.max(0,e.seconds/(e.exchange?.beatSeconds??BEAT));
 const attacker=e.exchange?.attacker??e.match.turn%2 as Side;
 const cue=turnCue(attacker,beat);
 const warning=viewSide!==null&&e.phase==="playing"?e.inputWarning:null;
 const heat=levelAt(Math.max(0,e.match.turn-(["impact","finished"].includes(e.phase)?1:0)));
 const pulse=e.phase==="playing"?Math.floor(beat*4)%4:0;
 const flash=e.flash&&e.seconds-e.flash.at<.45?e.flash:null;
 const result=e.outcome&&(e.phase==="impact"||(e.phase==="playing"&&beat<2))?e.outcome:null;
 const power=e.exchange?quality(e.exchange.attack):0;
 const cells=[];
 for(let y=-9;y<=9;y++)for(let x=-9;x<=9;x++)if(Math.hypot(x,y)<9)cells.push(<rect key={`${x}-${y}`} x={480+x*6} y={90+y*6} width="5" height="5" fill={Math.hypot(x,y)>7.8?CYAN:"#102443"}/>);
 return <div className="dot-scene-wrap"><svg className="duel-scene" viewBox="0 0 960 360" role="img" aria-label="シアンとピンクの音の生き物が、音符の弾とシールドで戦うドットのアリーナ" shapeRendering="crispEdges">
  <Backdrop/>
  <g className="dot-reactor" data-heat={heat} aria-label="難しさに応じて光の列が伸びる音符のコア">
   {cells}<Pixels rows={NOTE} x={459} y={66} color={pulse===0?"#ffffff":CYAN}/>
   {Array.from({length:16},(_,i)=>{const angle=i*Math.PI/8;const count=2+Math.min(heat,8)+((i+pulse)%3);return <g key={i}>{Array.from({length:count},(_,j)=><rect key={j} x={Math.round((480+Math.cos(angle)*(66+j*7))/6)*6} y={Math.round((90+Math.sin(angle)*(66+j*7))/6)*6} width="5" height="5" fill={[CYAN,PINK,LIME][i%3]}/>)}</g>;})}
  </g>
  {Array.from({length:24},(_,i)=><rect key={i} x={336+i*12} y="222" width="3" height="3" fill={i%4===pulse?"#516575":"#21213e"}/>)}
  {([0,1] as Side[]).map(side=>{
   const color=side===0?CYAN:PINK;
   const x=side===0?114:696;
   const hit=flash?.side===side?flash.grade:null;
   const damaged=result&&side!==result.attacker&&result.damage>0;
   const hp=e.match.hp[side];
   const defeated=hp===0;
   const fatigue=hp===0?4:hp<=20?3:hp<=40?2:hp<=70?1:0;
   const eyeHeight=hit==="miss"?5:[17,12,8,5,0][fatigue]!;
   const bob=e.phase==="playing"?(pulse<2?-6:0):0;
   const y=150+bob+(hit==="perfect"?-12:hit==="miss"?10:0);
   const wrong=warning?.side===side;
   return <g key={side}>
    <g transform={`translate(${x} ${y}) scale(1.4)`} opacity={defeated?.45:1} data-fatigue={fatigue}>
     <g key={wrong?`wait-${warning.at}`:hit?`hit-${flash!.at}`:"normal"} className={wrong?"dot-wrong-character":hit==="miss"?"dot-miss-character":undefined}>
     <Pixels rows={BODY} x={0} y={0} color={wrong?"#ffd166":damaged?"#ffffff":hit==="miss"?"#697487":hit==="perfect"?"#ffffff":color}/>
     {defeated ? <><Pixels rows={["10001","01010","00100","01010","10001"]} x={33} y={45} size={3} color="#ffffff"/><Pixels rows={["10001","01010","00100","01010","10001"]} x={63} y={45} size={3} color="#ffffff"/></> : <>
       <rect x="36" y="48" width="11" height={eyeHeight} fill="#ffffff"/><rect x="66" y="48" width="11" height={eyeHeight} fill="#ffffff"/>
       {eyeHeight>=8&&<><rect x={side===0?42:36} y="51" width="5" height="5" fill="#0b1632"/><rect x={side===0?72:66} y="51" width="5" height="5" fill="#0b1632"/></>}
       {fatigue>=2&&<><path d="M33 42h6v-3h9M63 39h9v3h6" stroke="#ffffff" strokeWidth="3" fill="none"/><Pixels rows={["010","111","111","010"]} x={84} y={42} size={3} color="#bedce5"/></>}
       {fatigue===3&&<Pixels rows={["010","111","111","010"]} x={24} y={54} size={3} color="#bedce5"/>}
     </>}
     <Pixels rows={defeated?["01110","11011","01110"]:wrong||hit==="miss"||fatigue>=2?["01110","10001"]:fatigue===1?["00000","11111"]:["10001","01110"]} x={42} y={72} size={6} color="#ffffff"/>
     </g>
    </g>
    <g role="progressbar" aria-label={`${side===0?"シアン":"ピンク"}の体力`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={hp}>{Array.from({length:23},(_,i)=><rect key={i} x={x+i*6} y="294" width="5" height="5" fill={i<Math.ceil(hp*23/100)?color:"#292640"}/>)}</g>
    {e.match.bonus[side]>0&&<g className="dot-power-note" aria-label="攻撃力アップ：大きな金色の音符">
      <Pixels rows={NOTE} x={side===0?72:858} y={228} size={5} color="#ffd166"/>
      <path d={`M${side===0?86:872} 220v-24m-9 9 9-9 9 9`} stroke="#ffd166" strokeWidth="4" fill="none"/>
    </g>}
    {e.phase==="playing"&&beat>=8&&side!==attacker&&<g opacity={hit==="miss"?.22:1}>{Array.from({length:17},(_,i)=><rect key={i} x={side===0?270-Math.abs(i-8)*3:684+Math.abs(i-8)*3} y={168+i*6} width="5" height="5" fill={hit==="perfect"?LIME:color}/>)}</g>}
    {hit&&<g key={flash!.at} className={`dot-hit-effect ${hit}`} aria-label={hit==="miss"?"音符が崩れて落ちる":hit==="perfect"?"大きなきらめき":"小さなきらめき"}>
      {hit==="miss"?<g className="dot-broken-note">
        <Pixels rows={["001100","001110","001001","001000","110000","110000"]} x={x+(side===0?162:-54)} y={160} size={6} color="#ff988f"/>
        {[0,1,2,3].map(i=><rect key={i} x={x+50+i*15} y={264+(i%2)*12} width="7" height="7" fill="#ff988f"/>)}
      </g>:<g>{[0,1,2,3].slice(0,hit==="perfect"?4:2).map(i=><path key={i} d="M0 -12V12M-12 0H12" transform={`translate(${x+(i%2?154:-12)} ${160+Math.floor(i/2)*100}) scale(${hit==="perfect"?1:.65})`} stroke={hit==="perfect"?"#fff1af":"#ffffff"} strokeWidth="5"/>)}</g>}
    </g>}
    {damaged&&<text key={`damage-${e.match.turn}`} className="dot-bar-damage" x={x+68} y="332" textAnchor="middle" fontSize="25" fontWeight="bold" fill="#ffb3ba" stroke="#080c24" strokeWidth="5" paintOrder="stroke">−{result.damage}</text>}
   </g>;
  })}
  {e.phase==="playing"&&e.exchange&&(beat>=7)&&e.exchange.defense.notes.map((note,i)=>{
   const duration=note.endBeat===undefined?0:note.endBeat-note.beat;
   const travel=beat-(note.beat-1);if(travel<0||travel>1.35+duration||power===0)return null;
   const blocked=note.grade==="perfect"||note.grade==="good";
   const progress=Math.min(travel,1);
   const x=attacker===0?270+progress*408:684-progress*408;
   const charged=e.match.bonus[attacker]>0;
   const color=charged?"#ffd166":attacker===0?CYAN:PINK;
   return <g key={i}>{blocked&&travel>=1+duration?<g>{Array.from({length:8},(_,k)=><rect key={k} x={Math.round((x+Math.cos(k*Math.PI/4)*(12+(travel-1-duration)*80))/6)*6} y={Math.round((220+Math.sin(k*Math.PI/4)*(12+(travel-1-duration)*80))/6)*6} width="5" height="5" fill={note.grade==="perfect"?LIME:color}/>)}</g>:duration>0?<NoteComet x={x} length={cometMotion(travel,duration).length} side={attacker} color={color} size={charged?7:5}/>:<Pixels rows={NOTE} x={Math.round(x/6)*6-12} y={204} size={charged?7:power>.65?5:4} color={color}/>}</g>;
  })}
  {e.phase==="playing"&&beat>=4&&beat<8&&e.exchange?.attack.notes.map((note,i)=>{
   if(!note.endBeat||!note.holdGrade||note.grade==="miss"||beat<note.beat||beat>note.endBeat+.3)return null;
   const length=Math.min(note.endBeat-note.beat,Math.max(0,beat-note.beat))*108;
   const fade=beat>note.endBeat?Math.max(0,1-(beat-note.endBeat)/.3):1;
   return <g key={i} opacity={fade}><NoteComet x={attacker===0?276+length:678-length} length={length} side={attacker} color={attacker===0?CYAN:PINK}/></g>;
  })}
  {e.phase==="playing"&&beat>=4&&beat<8&&!e.exchange?.attack.notes.some(n=>n.holdGrade&&n.grade!=="miss"&&n.endBeat!==undefined&&beat>=n.beat&&beat<=n.endBeat+.3)&&flash?.side===attacker&&flash.grade!=="miss"&&<Pixels rows={NOTE} x={attacker===0?264:666} y={204} size={5} color={attacker===0?CYAN:PINK}/>}
 </svg>
 {viewSide !== null && e.phase === "playing" && ([0,1] as Side[]).map(side => {
   const now = cue.current === side;
   const next = cue.next === side;
   const wrong = warning?.side === side;
   if ((e.mode !== "local" && side !== viewSide) || (!now && !next && !wrong)) return null;
   return <div key={side} className={`dot-turn-badge side-${side} ${now ? "is-now" : "is-next"} ${wrong ? "is-wrong-turn" : ""}`} role="img" aria-label={wrong ? warning.message : `${cueName(side,e.mode,viewSide)}：${now?"今の番":"次の番"}`}>
     <BattleIcon kind={wrong ? "wait" : "tap"}/>
     <svg className="dot-turn-arrow" viewBox="0 0 40 20" aria-hidden="true"><path d="M4 2h32L20 18Z" fill="currentColor"/></svg>
   </div>;
 })}
 </div>;
}
