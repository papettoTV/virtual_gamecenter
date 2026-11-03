type AudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

export function createGrazeAudio() {
  let audioContext: AudioContext | null = null;
  let disposed = false;
  let grazeNoise: AudioBuffer | null = null;
  let lastGrazeTime = -Infinity;

  function getAudioContext(): AudioContext {
    if (!audioContext) {
      const AudioContextConstructor =
        window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
      if (!AudioContextConstructor) {
        throw new Error("Web Audio API is not supported.");
      }
      audioContext = new AudioContextConstructor();
    }
    if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
    return audioContext;
  }

  function playGrazeSound(combo: number): void {
    if (disposed) return;
    const audio = getAudioContext();
    const now = audio.currentTime;
    if (now - lastGrazeTime < 0.03) return;
    lastGrazeTime = now;
    if (!grazeNoise) {
      grazeNoise = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.06), audio.sampleRate);
      const data = grazeNoise.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    }
    const noise = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gainNode = audio.createGain();
    const accent = audio.createOscillator();
    const accentGain = audio.createGain();
    const intensity = Math.min(24, Math.max(0, combo));
    noise.buffer = grazeNoise;
    filter.type = "bandpass";
    filter.Q.setValueAtTime(0.85, now);
    filter.frequency.setValueAtTime(4200, now);
    filter.frequency.exponentialRampToValueAtTime(2000, now + 0.045);
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(0.024 + intensity * 0.0002, now + 0.002);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    noise.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(audio.destination);
    accent.type = "sine";
    accent.frequency.setValueAtTime(1800 + intensity * 12, now);
    accent.frequency.exponentialRampToValueAtTime(1150 + intensity * 8, now + 0.028);
    accentGain.gain.setValueAtTime(0.0001, now);
    accentGain.gain.exponentialRampToValueAtTime(0.022, now + 0.0015);
    accentGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
    accent.connect(accentGain);
    accentGain.connect(audio.destination);
    noise.onended = () => { noise.disconnect(); filter.disconnect(); gainNode.disconnect(); };
    accent.onended = () => { accent.disconnect(); accentGain.disconnect(); };
    noise.start(now);
    noise.stop(now + 0.06);
    accent.start(now);
    accent.stop(now + 0.08);
  }

  function playAttackSound(): void {
    playSweep("sawtooth", 180, 760, 0.11, 0.08, 0.18);
  }

  function playBossAttackSound(): void {
    playSweep("square", 92, 280, 0.22, 0.11, 0.3);
  }

  function playBossHitSound(): void {
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
    if (disposed) return;
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

  function playExplosionSound(): void {
    if (disposed) return;
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
  return {
    playGrazeSound,
    playAttackSound,
    playBossAttackSound,
    playBossHitSound,
    playExplosionSound,
    dispose() {
      if (disposed) return;
      disposed = true;
      const closingContext = audioContext;
      audioContext = null;
      grazeNoise = null;
      if (closingContext && closingContext.state !== "closed") {
        void closingContext.close().catch(() => {});
      }
    },
  };
}
