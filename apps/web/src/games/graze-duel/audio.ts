type AudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    const AudioContextConstructor =
      window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("Web Audio API is not supported.");
    }
    audioContext = new AudioContextConstructor();
  }
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

export function playGrazeSound(combo: number): void {
  const audio = getAudioContext();
  const now = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gainNode = audio.createGain();
  const pitch = 520 + Math.min(combo, 24) * 18;

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(pitch, now);
  oscillator.frequency.exponentialRampToValueAtTime(pitch * 1.35, now + 0.045);
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.045, now + 0.006);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
  oscillator.connect(gainNode);
  gainNode.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.06);
}

export function playAttackSound(): void {
  playSweep("sawtooth", 180, 760, 0.11, 0.08, 0.18);
}

export function playBossAttackSound(): void {
  playSweep("square", 92, 280, 0.22, 0.11, 0.3);
}

export function playBossHitSound(): void {
  playSweep("triangle", 380, 120, 0.08, 0.09, 0.12);
}

function playSweep(
  type: OscillatorType,
  startFrequency: number,
  endFrequency: number,
  sweepTime: number,
  volume: number,
  duration: number,
): void {
  const audio = getAudioContext();
  const now = audio.currentTime;
  const oscillator = audio.createOscillator();
  const gainNode = audio.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(startFrequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + sweepTime);
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(volume, now + 0.012);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration - 0.02);
  oscillator.connect(gainNode);
  gainNode.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

export function playExplosionSound(): void {
  const audio = getAudioContext();
  const now = audio.currentTime;
  const noiseLength = Math.floor(audio.sampleRate * 0.38);
  const buffer = audio.createBuffer(1, noiseLength, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < noiseLength; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / noiseLength);
  }

  const noise = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const gainNode = audio.createGain();
  noise.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1200, now);
  filter.frequency.exponentialRampToValueAtTime(90, now + 0.35);
  gainNode.gain.setValueAtTime(0.16, now);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
  noise.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(audio.destination);
  noise.start(now);
  noise.stop(now + 0.4);
}
