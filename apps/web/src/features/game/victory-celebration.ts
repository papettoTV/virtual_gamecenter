import "./victory-celebration.css";

const profiles = {
  buzz: { label: "VICTORY", colors: ["#57edff", "#fe4c91", "#fff59a", "#b587ff"], duration: 1700, stagger: 24, cheerDelay: 0 },
  dot: { label: "WIN", colors: ["#4bfcff", "#ff66dc", "#d2a1ff", "#ffffff"], duration: 1350, stagger: 48, cheerDelay: .18 },
} as const;

export function winningMatch(
  matchId: string | null, result: { matchId: string; winner: "host" | "challenger" | "draw" } | null,
  seat: "host" | "challenger" | null,
): string | null {
  return matchId && result?.matchId === matchId && seat && result.winner === seat ? matchId : null;
}

export function createVictoryCelebration(game: keyof typeof profiles) {
  const profile = profiles[game];
  let lastMatch: string | null = null;
  let layer: HTMLElement | undefined;
  let timer: number | undefined;
  let stopSound: (() => void) | undefined;
  function clear() {
    window.clearTimeout(timer);
    layer?.remove();
    layer = undefined;
    stopSound?.();
    stopSound = undefined;
  }
  return {
    clear,
    play(matchId: string | null, target: Element | null, cheer: (delay: number) => (() => void) | undefined) {
      if (!matchId || matchId === lastMatch || !target) return;
      clear();
      lastMatch = matchId;
      layer = document.createElement("div");
      layer.className = "victory-celebration";
      layer.dataset.victoryGame = game;
      layer.setAttribute("aria-hidden", "true");
      layer.style.setProperty("--victory-duration", `${profile.duration}ms`);
      layer.style.setProperty("--victory-accent", profile.colors[0]);
      const label = document.createElement("strong");
      label.className = "victory-celebration-label";
      label.textContent = profile.label;
      layer.appendChild(label);
      for (let index = 0; index < 36; index++) {
        const piece = document.createElement("span");
        piece.style.setProperty("--piece-color", profile.colors[index % profile.colors.length] ?? profile.colors[0]);
        piece.style.setProperty("--piece-left", `${7 + (index * 37) % 86}%`);
        piece.style.setProperty("--piece-shift", `${(index * 19) % 91 - 45}px`);
        piece.style.setProperty("--piece-spin", `${(index % 2 ? 1 : -1) * (280 + index * 17)}deg`);
        piece.style.setProperty("--piece-delay", `${index % 6 * profile.stagger}ms`);
        layer.appendChild(piece);
      }
      target.appendChild(layer);
      timer = window.setTimeout(clear, profile.duration + 250);
      stopSound = cheer(profile.cheerDelay);
    },
  };
}

export function playVictoryCheer(context: AudioContext, output: AudioNode, delay: number): (() => void) | undefined {
  if (context.state !== "running") return;
  const duration = .83;
  const start = context.currentTime + delay;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  const voices = [173, 207, 242, 283, 337, 382].map((pitch, index) => ({
    pitch, phase: 0, onset: index * .014, rise: 32 + index * 3,
  }));
  let breath = 0;
  for (let index = 0; index < samples.length; index++) {
    const time = index / context.sampleRate;
    const noise = Math.random() * 2 - 1;
    breath = breath * .78 + noise * .22;
    let crowd = 0;
    for (const voice of voices) {
      const age = time - voice.onset;
      if (age < 0) continue;
      voice.phase += 2 * Math.PI * (voice.pitch + voice.rise * Math.sin(age * 6) + 9 * Math.sin(age * 43)) / context.sampleRate;
      const vowel = Math.sin(voice.phase * 3) + .7 * Math.sin(voice.phase * 5) + .27 * Math.sin(voice.phase * 7);
      crowd += vowel * Math.min(1, age * 20) * (1 - age / duration);
    }
    const clap = (time * 13) % 1;
    samples[index] = (crowd * .036 + breath * .35 + noise * Math.exp(-clap * 23) * .17) * (1 - time / duration);
  }
  const source = context.createBufferSource();
  const envelope = context.createGain();
  source.buffer = buffer;
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(.58, start + .065);
  envelope.gain.linearRampToValueAtTime(0, start + duration);
  source.connect(envelope).connect(output);
  source.onended = () => { source.disconnect(); envelope.disconnect(); };
  source.start(start);
  return () => { if (context.state !== "closed") source.stop(); };
}
