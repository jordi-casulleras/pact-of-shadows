/**
 * All sound is synthesised with Web Audio: there are no audio files to load.
 * Nothing plays until `unlockAudio` runs inside a user gesture, as browsers require.
 */

export type Sfx =
  | 'click'
  | 'card'
  | 'turn'
  | 'reveal'
  | 'trick'
  | 'win'
  | 'capture'
  | 'roundEnd'
  | 'victory'
  | 'defeat';

// A miyako-bushi style pentatonic scale on D.
const D3 = 146.83;
const D4 = 293.66;
const EB4 = 311.13;
const G4 = 392.0;
const A4 = 440.0;
const BB4 = 466.16;
const D5 = 587.33;
const SCALE = [D4, EB4, G4, A4, BB4, D5, EB4 * 2, G4 * 2];

const SFX_LEVEL = 0.5;
const MUSIC_LEVEL = 0.16;
const STEP = 0.4;

let ctx: AudioContext | null = null;
let sfxBus: GainNode;
let musicBus: GainNode;
let noise: AudioBuffer;
let sfxOn = true;
let musicOn = true;
let musicTimer: ReturnType<typeof setInterval> | undefined;
let nextStep = 0;
let stepIndex = 0;
let phrase: (number | null)[] = [];

function pluck(at: number, freq: number, level: number, length: number, out: AudioNode): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, at);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.min(freq * 6, 9000), at);
  filter.frequency.exponentialRampToValueAtTime(freq * 1.2, at + length * 0.6);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level, at + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(filter).connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

function burst(at: number, freq: number, level: number, length: number, out: AudioNode): void {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  src.buffer = noise;
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 0.8;
  gain.gain.setValueAtTime(level, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  src.connect(filter).connect(gain).connect(out);
  src.start(at);
  src.stop(at + length + 0.02);
}

function taiko(at: number, level: number, out: AudioNode): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, at);
  osc.frequency.exponentialRampToValueAtTime(46, at + 0.25);
  gain.gain.setValueAtTime(level, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + 0.6);
  burst(at, 700, level * 0.5, 0.05, out);
}

function partials(at: number, base: number, ratios: number[], level: number, length: number, out: AudioNode): void {
  if (!ctx) return;
  ratios.forEach((ratio, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.value = base * ratio;
    gain.gain.setValueAtTime(level / (i + 1), at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length / (1 + i * 0.4));
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + length + 0.05);
  });
}

const run = (at: number, notes: number[], gap: number, level: number, length: number) =>
  notes.forEach((freq, i) => pluck(at + i * gap, freq, level, length, sfxBus));

export function sfx(name: Sfx): void {
  if (!ctx || !sfxOn || ctx.state !== 'running') return;
  const at = ctx.currentTime + 0.01;
  switch (name) {
    case 'click':
      pluck(at, D5, 0.25, 0.12, sfxBus);
      break;
    case 'card':
      burst(at, 2600, 0.5, 0.07, sfxBus);
      burst(at + 0.03, 900, 0.3, 0.05, sfxBus);
      break;
    case 'turn':
      partials(at, 880, [1, 2.76], 0.14, 0.7, sfxBus);
      break;
    case 'reveal':
      taiko(at, 0.9, sfxBus);
      taiko(at + 0.2, 0.7, sfxBus);
      break;
    case 'trick':
      pluck(at, D3, 0.3, 0.5, sfxBus);
      break;
    case 'win':
      run(at, [A4, D5], 0.11, 0.35, 0.6);
      break;
    case 'capture':
      run(at, [D5, G4 * 2, A4 * 2, D5 * 2], 0.06, 0.3, 0.5);
      partials(at + 0.24, 1174, [1, 2.76, 5.4], 0.2, 1.2, sfxBus);
      break;
    case 'roundEnd':
      partials(at, 110, [1, 2.4, 3.9, 5.3], 0.5, 2.6, sfxBus);
      break;
    case 'victory':
      run(at, [D4, G4, A4, D5, G4 * 2], 0.15, 0.4, 0.9);
      partials(at + 0.75, 147, [1, 2.4, 3.9], 0.35, 2.8, sfxBus);
      taiko(at + 0.75, 0.8, sfxBus);
      break;
    case 'defeat':
      run(at, [D5, BB4, G4, EB4, D4], 0.24, 0.3, 1.1);
      break;
  }
}

const PHRASES: (number | null)[][] = [
  [0, null, 2, 3, null, 4, 3, null, 2, null, 1, 0, null, null, null, null],
  [3, null, 4, 5, null, null, 4, 3, null, 2, null, 3, null, null, null, null],
  [5, null, null, 4, 3, null, 2, null, 1, null, 0, null, null, null, null, null],
  [0, 1, 0, null, 2, null, 3, null, 4, null, null, 3, 2, null, null, null],
  [null, null, 3, null, 5, null, 6, 5, null, 4, null, 3, null, null, null, null],
  [2, null, null, null, 3, null, null, null, 1, null, 0, null, null, null, null, null],
];

function scheduleMusic(): void {
  if (!ctx || ctx.state !== 'running') return;
  if (nextStep < ctx.currentTime) nextStep = ctx.currentTime + 0.1;
  while (nextStep < ctx.currentTime + 0.8) {
    const step = stepIndex % 16;
    const bar = Math.floor(stepIndex / 16);
    if (step === 0) phrase = PHRASES[Math.floor(Math.random() * PHRASES.length)];
    const note = phrase[step];
    if (note !== null) pluck(nextStep, SCALE[note], 0.5, 1.6, musicBus);
    if (step === 0 || step === 8) pluck(nextStep, D3 / 2, 0.6, 2.4, musicBus);
    if (step === 0 && bar % 2 === 1) taiko(nextStep, 0.5, musicBus);
    if (step === 14 && bar % 4 === 3) taiko(nextStep, 0.35, musicBus);
    nextStep += STEP;
    stepIndex++;
  }
}

function syncMusic(): void {
  const shouldPlay = !!ctx && musicOn;
  if (shouldPlay && musicTimer === undefined) {
    scheduleMusic();
    musicTimer = setInterval(scheduleMusic, 200);
  } else if (!shouldPlay && musicTimer !== undefined) {
    clearInterval(musicTimer);
    musicTimer = undefined;
  }
  if (ctx) musicBus.gain.setTargetAtTime(musicOn ? MUSIC_LEVEL : 0, ctx.currentTime, 0.2);
}

export function configureAudio(options: { sfx: boolean; music: boolean }): void {
  sfxOn = options.sfx;
  musicOn = options.music;
  syncMusic();
}

/**
 * Call from a user gesture. Safe to call repeatedly. On iOS the start of a touch does not count
 * as one, only its end (touchend, pointerup, click), so it must be called from those too.
 */
export function unlockAudio(): void {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    sfxBus = ctx.createGain();
    sfxBus.gain.value = SFX_LEVEL;
    sfxBus.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0;
    musicBus.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx?.suspend();
      else void ctx?.resume();
    });
  }
  // Not only 'suspended': iOS leaves the context 'interrupted' after a call or a switch of app.
  if (ctx.state !== 'running' && !document.hidden) void ctx.resume();
  syncMusic();
}

/** Whether the audio engine is running; used by automated checks. */
export const audioState = () => ({ running: ctx?.state === 'running', sfxOn, musicOn, musicPlaying: musicTimer !== undefined });
