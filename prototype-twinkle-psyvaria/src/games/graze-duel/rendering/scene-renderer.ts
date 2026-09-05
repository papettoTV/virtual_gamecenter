export type BulletRenderState = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  shape?: "circle" | "diamond" | "triangle" | "square" | "star" | "pill" | "line" | "spinner" | "smallCircle";
  rotation?: number;
  age: number;
  type: string;
  spectatorRenderBaseX?: number;
  spectatorRenderBaseY?: number;
  spectatorRenderBaseElapsed?: number;
};

export type PlayerRenderState = {
  fieldX: number;
  x: number;
  y: number;
  color: string;
  tilt: number;
  invincible: number;
  levelUpInvincible: number;
  barrierRatio: number;
  levelUpFlash: number;
  bullets: BulletRenderState[];
};

export type BossRenderState = {
  active: boolean;
  phaseIndex: number;
  x: number;
  y: number;
  radius: number;
  hp: number;
  flash: number;
  encounterState: string;
  arrivalProgress: number;
};

export type ParticleRenderState = {
  x: number;
  y: number;
  color: string;
  life: number;
  size?: number;
};

export type SceneRenderFrame = {
  players: PlayerRenderState[];
  boss: BossRenderState;
  opponentBoss: BossRenderState;
  particles: ParticleRenderState[];
};

export type RenderOptions = {
  compact: boolean;
  selectedPlayerIndex: number;
  fieldTop: number;
  fieldBottom: number;
  fieldWidth: number;
  gpuReplay: boolean;
  revision: number;
};

export type RendererMetrics = {
  fps: number;
  drawCalls: number;
  bulletCount: number;
  gpuReplay: boolean;
};

export interface GameSceneRenderer {
  mount(host: Element | null, referenceCanvas: HTMLCanvasElement): void;
  render(frame: SceneRenderFrame, elapsed: number, options: RenderOptions): void;
  getMetrics(): RendererMetrics;
  dispose(): void;
}
