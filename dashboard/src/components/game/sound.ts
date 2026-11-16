const MASTER_VOLUME = 0.55;
const ARPEGGIO = [523.25, 659.25, 783.99, 1046.5];

type Wave = OscillatorType;

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted: boolean;

  constructor(muted: boolean) {
    this.muted = muted;
  }

  private output(): { ctx: AudioContext; master: GainNode } | null {
    if (this.muted || typeof window === "undefined" || typeof window.AudioContext === "undefined") return null;
    if (!this.context || !this.master) {
      this.context = new window.AudioContext();
      const compressor = this.context.createDynamicsCompressor();
      this.master = this.context.createGain();
      this.master.gain.value = MASTER_VOLUME;
      this.master.connect(compressor).connect(this.context.destination);
    }
    if (this.context.state === "suspended") void this.context.resume();
    return { ctx: this.context, master: this.master };
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  private tone(at: number, frequency: number, duration: number, volume: number, wave: Wave = "sine", glideTo?: number): void {
    const out = this.output();
    if (!out) return;
    const { ctx, master } = out;
    const start = ctx.currentTime + at;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (glideTo) oscillator.frequency.exponentialRampToValueAtTime(glideTo, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private hiss(at: number, duration: number, volume: number, frequency: number, toFrequency: number, q = 1.2): void {
    const out = this.output();
    if (!out) return;
    const { ctx, master } = out;
    const start = ctx.currentTime + at;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer(ctx);
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = q;
    filter.frequency.setValueAtTime(frequency, start);
    filter.frequency.exponentialRampToValueAtTime(toFrequency, start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.04, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(start, Math.random() * 0.5);
    source.stop(start + duration + 0.02);
  }

  select(): void {
    this.tone(0, 640, 0.09, 0.07, "sine", 900);
  }

  deselect(): void {
    this.tone(0, 760, 0.08, 0.05, "sine", 520);
  }

  invalid(): void {
    this.tone(0, 190, 0.09, 0.05, "square", 150);
    this.tone(0.08, 150, 0.12, 0.05, "square", 110);
  }

  pour(durationMs: number, fillFrom: number, fillTo: number): void {
    if (!this.output()) return;
    const duration = durationMs / 1000;
    this.hiss(0, duration, 0.035, 900 + fillFrom * 900, 1100 + fillTo * 1200, 0.9);
    for (let at = 0.02; at < duration - 0.03; at += 0.045 + Math.random() * 0.05) {
      const fill = fillFrom + (fillTo - fillFrom) * (at / duration);
      const pitch = (260 + fill * 620) * (0.88 + Math.random() * 0.28);
      this.tone(at, pitch, 0.06, 0.045, "sine", pitch * 1.7);
    }
  }

  undo(): void {
    this.hiss(0, 0.16, 0.03, 1800, 700, 0.9);
    this.tone(0, 880, 0.14, 0.05, "sine", 520);
  }

  seal(): void {
    this.hiss(0, 0.06, 0.12, 2400, 900, 0.7);
    this.tone(0.03, 1318.5, 0.5, 0.05);
    this.tone(0.09, 1975.5, 0.6, 0.035);
  }

  win(): void {
    ARPEGGIO.forEach((frequency, i) => this.tone(i * 0.09, frequency, 0.55, 0.07, "triangle"));
    this.tone(0.36, 2093, 0.9, 0.03);
    this.hiss(0.3, 0.7, 0.025, 6000, 9000, 0.6);
  }

  stuck(): void {
    [392, 329.6, 261.6].forEach((frequency, i) => this.tone(i * 0.15, frequency, 0.32, 0.06, "triangle"));
  }

  dispose(): void {
    void this.context?.close().catch(() => {});
    this.context = null;
    this.master = null;
    this.noise = null;
  }
}

export function vibrate(pattern: number | number[]): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
}
