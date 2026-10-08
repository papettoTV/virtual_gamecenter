import { useEffect, useRef, useState } from 'react';
import { fetchScoreRanking, loadRankingWithNotice, submitRankingEntry, type RankingEntry } from '../../../features/ranking/ranking-client';
import type { Score } from './score';

// Keep rankings separate from earlier prototypes and future scoring changes.
export const DOT_WAVE_SCORE_VERSION = 'dot-wave-score-1';
export function rankingSubmission(score: Score, elapsedTimeMs: number) {
  return { gameId: 'dot-wave', clientVersion: DOT_WAVE_SCORE_VERSION, score: score.total,
    elapsedTimeMs: Math.max(1, Math.round(elapsedTimeMs)), cleared: true, maxLevel: 3, defeatedBossCount: 3 };
}
export function DotWaveRanking({ score, elapsedTimeMs, playerName }: { score: Score; elapsedTimeMs: number; playerName: string }) {
  const [status, setStatus] = useState<'ready' | 'sending' | 'submitted'>('ready');
  const [entries, setEntries] = useState<RankingEntry[]>([]);
  const pending = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function submit() {
    if (pending.current || status === 'submitted') return;
    pending.current = true; setStatus('sending');
    try {
      await submitRankingEntry(rankingSubmission(score, elapsedTimeMs));
      if (!alive.current) return;
      setStatus('submitted');
      await loadRankingWithNotice('dot-wave', async () => {
        const ranking = await fetchScoreRanking('dot-wave', 10, DOT_WAVE_SCORE_VERSION);
        if (alive.current) setEntries(ranking);
      });
    } catch { if (alive.current) setStatus('ready'); }
    finally { pending.current = false; }
  }
  return <div className="dot-ranking">
    <p className="dot-ranking-score">SCORE <strong>{score.total.toLocaleString()}</strong></p>
    <button onClick={() => void submit()} disabled={status !== 'ready'}>
      {status === 'sending' ? '登録中…' : status === 'submitted' ? '登録済み' : 'ランキングに登録'}
    </button>
    <small className="dot-ranking-name">{playerName} として登録</small>
    {entries.length > 0 && <table aria-label="DOT WAVEスコアランキング">
      <thead><tr><th>順位</th><th>プレイヤー</th><th>スコア</th></tr></thead>
      <tbody>{entries.map((entry, index) => <tr key={`${entry.created_at}-${index}`}>
        <td>{index + 1}</td><td title={entry.player_name}>{entry.player_name}</td><td>{entry.score.toLocaleString()}</td>
      </tr>)}</tbody>
    </table>}
  </div>;
}
