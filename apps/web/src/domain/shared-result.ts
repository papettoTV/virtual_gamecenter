export interface SharedResultDraft {
  id: string;
  gameId: string;
  gameVersion: string;
  elapsedTimeMs: number;
  cleared: boolean;
  score: number;
  metrics: Record<string, string | number | boolean>;
}

export interface SharedResult extends SharedResultDraft {
  playerName: string;
  createdAt: string;
}

export interface ResultPresentation {
  title: string;
  headline: string;
  details: string[];
  text: string;
  accent: string;
  imageLines: string[];
}
