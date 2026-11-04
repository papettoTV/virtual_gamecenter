import grazeSoundUrl from "./assets/graze-u3.wav?url";

type AudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

export function createGrazeAudio() {
  let audioContext: AudioContext | null = null;
  let disposed = false;
  let grazeBuffer: Promise<AudioBuffer> | null = null;
  let lastGrazeTime = -Infinity;
  let pendingGrazes = 0;
  const grazeVoices = new Map<AudioBufferSourceNode, GainNode>();

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

  async function playGrazeSound(_combo: number): Promise<void> {
    if (disposed) return;
    const audio = getAudioContext();
    const now = audio.currentTime;
    if (now - lastGrazeTime < 0.03 || pendingGrazes + grazeVoices.size >= 8) return;
    lastGrazeTime = now;
    pendingGrazes += 1;
    try {
      if (!grazeBuffer) {
        grazeBuffer = fetch(grazeSoundUrl)
          .then(response => {
            if (!response.ok) throw new Error("Graze sound could not be loaded.");
            return response.arrayBuffer();
          })
          .then(data => audio.decodeAudioData(data));
      }
      const buffer = await grazeBuffer;
      if (disposed) return;
      const source = audio.createBufferSource();
      const gain = audio.createGain();
      source.buffer = buffer;
      gain.gain.setValueAtTime(0.4, audio.currentTime);
      source.connect(gain);
      gain.connect(audio.destination);
      grazeVoices.set(source, gain);
      source.onended = () => {
        if (!grazeVoices.delete(source)) return;
        source.disconnect();
        gain.disconnect();
      };
      source.start(audio.currentTime);
    } catch (error) {
      grazeBuffer = null;
      if (!disposed) console.warn("Graze sound playback failed.", error);
    } finally {
      pendingGrazes -= 1;
    }
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
      grazeBuffer = null;
      for (const [source, gain] of grazeVoices) {
        source.onended = null;
        source.stop();
        source.disconnect();
        gain.disconnect();
      }
      grazeVoices.clear();
      if (closingContext && closingContext.state !== "closed") {
        void closingContext.close().catch(() => {});
      }
    },
  };
}
