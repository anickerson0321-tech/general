// Synthetic "sung" signals for tests and demos: band-limited (PolyBLEP) sawtooth
// glottal source, spectral tilt, parallel formant resonators, vibrato, jitter,
// breath noise, consonant hiss bursts and note envelopes.

import { biquad, designBiquad } from '../biquad'
import { makeRng } from '../util'

export interface SynthNote {
  start: number
  end: number
  /** MIDI pitch (fractional allowed, e.g. 69.4 = A4 +40 cents) */
  midi: number
  /** scoop into the note from this many semitones below (0 = none) */
  scoop?: number
}

export interface SynthOptions {
  sr: number
  duration: number
  notes: SynthNote[]
  vibratoHz?: number
  vibratoCents?: number
  /** add short unvoiced consonant noise bursts before notes */
  consonants?: boolean
  breathNoise?: number
  /** steady background noise (room / hiss), linear RMS */
  noiseFloor?: number
  amp?: number
  seed?: number
  vowel?: 'a' | 'o' | 'e'
}

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt
    return x + x - x * x - 1
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt
    return x * x + x + x + 1
  }
  return 0
}

const VOWELS = {
  a: [
    [730, 90, 1.0],
    [1090, 110, 0.5],
    [2440, 160, 0.25],
    [3400, 250, 0.12],
  ],
  o: [
    [570, 80, 1.0],
    [840, 100, 0.45],
    [2410, 170, 0.15],
    [3300, 250, 0.08],
  ],
  e: [
    [530, 80, 1.0],
    [1840, 130, 0.45],
    [2480, 170, 0.3],
    [3500, 250, 0.12],
  ],
} as const

/** Instantaneous f0 (Hz) the synth uses at time t (NaN when silent) — for test ground truth. */
export function synthF0At(opts: SynthOptions, t: number, includeVibrato = true): number {
  const note = opts.notes.find((n) => t >= n.start && t < n.end)
  if (!note) return NaN
  let m = note.midi
  if (note.scoop) {
    const k = Math.min(1, (t - note.start) / 0.12)
    m -= note.scoop * (1 - k * k * (3 - 2 * k))
  }
  if (includeVibrato) {
    const vibOn = Math.min(1, Math.max(0, (t - note.start - 0.15) / 0.25))
    m += (((opts.vibratoCents ?? 0) / 100) * vibOn) * Math.sin(2 * Math.PI * (opts.vibratoHz ?? 5.5) * (t - note.start))
  }
  return 440 * Math.pow(2, (m - 69) / 12)
}

export function synthVoice(opts: SynthOptions): Float32Array {
  const { sr, duration } = opts
  const n = Math.round(duration * sr)
  const src = new Float32Array(n)
  const env = new Float32Array(n)
  const rng = makeRng(opts.seed ?? 1)
  let phase = 0
  let jitter = 0
  const sorted = [...opts.notes].sort((a, b) => a.start - b.start)
  let ni = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    while (ni < sorted.length && t >= sorted[ni].end) ni++
    const note = ni < sorted.length && t >= sorted[ni].start ? sorted[ni] : undefined
    if (!note) {
      phase = 0
      continue
    }
    const f = synthF0At(opts, t)
    jitter = 0.999 * jitter + 0.001 * (rng() - 0.5) * 2
    const ff = f * (1 + 0.004 * jitter)
    const dt = ff / sr
    phase += dt
    if (phase >= 1) phase -= 1
    src[i] = 2 * phase - 1 - polyBlep(phase, dt)
    const a = Math.min(1, (t - note.start) / 0.03, (note.end - t) / 0.05)
    env[i] = Math.max(0, a)
  }
  // glottal spectral tilt (saw is -6 dB/oct; add a gentle extra roll-off)
  biquad(src, designBiquad('lowpass', 2500, sr, 0.5))
  biquad(src, designBiquad('highpass', 70, sr, 0.7))
  // formants: Klatt-style cascade of unity-DC-gain resonators (realistic vocal tract)
  const formants = VOWELS[opts.vowel ?? 'a']
  const out = new Float32Array(src)
  for (const [fc, bw] of formants) {
    const T = 1 / sr
    const C = -Math.exp(-2 * Math.PI * bw * T)
    const B = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(2 * Math.PI * fc * T)
    const A = 1 - B - C
    let y1 = 0
    let y2 = 0
    for (let i = 0; i < n; i++) {
      const y = A * out[i] + B * y1 + C * y2
      y2 = y1
      y1 = y
      out[i] = y
    }
  }
  // breath noise (aspiration) during notes
  const breath = opts.breathNoise ?? 0.01
  const hiss = new Float32Array(n)
  for (let i = 0; i < n; i++) hiss[i] = (rng() * 2 - 1)
  biquad(hiss, designBiquad('highpass', 1500, sr, 0.7))
  for (let i = 0; i < n; i++) out[i] = out[i] * env[i] + breath * hiss[i] * env[i]
  // consonants: 60 ms "s"/"t" hiss bursts just before each note
  if (opts.consonants) {
    const s = new Float32Array(n)
    for (let i = 0; i < n; i++) s[i] = rng() * 2 - 1
    biquad(s, designBiquad('bandpass', 6500, sr, 1.2))
    for (const note of sorted) {
      const a = Math.max(0, Math.round((note.start - 0.07) * sr))
      const b = Math.min(n, Math.round(note.start * sr))
      for (let i = a; i < b; i++) {
        const k = (i - a) / Math.max(1, b - a)
        out[i] += 0.25 * s[i] * Math.sin(Math.PI * k)
      }
    }
  }
  // normalise
  let pk = 0
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]))
  const g = (opts.amp ?? 0.5) / (pk || 1)
  const nf = opts.noiseFloor ?? 0
  for (let i = 0; i < n; i++) out[i] = out[i] * g + (nf ? nf * (rng() * 2 - 1) * 1.7 : 0)
  return out
}

/** Plain harmonic tone (sawtooth-ish) with vibrato. */
export function harmonicTone(sr: number, dur: number, hz: number, vibHz = 5.5, vibCents = 30): Float32Array {
  const n = Math.round(sr * dur)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const f = hz * Math.pow(2, ((vibCents / 1200) * Math.sin(2 * Math.PI * vibHz * t)))
    const dt = f / sr
    phase += dt
    if (phase >= 1) phase -= 1
    out[i] = 0.4 * (2 * phase - 1 - polyBlep(phase, dt))
  }
  return out
}

export function toneF0(hz: number, t: number, vibHz = 5.5, vibCents = 30): number {
  return hz * Math.pow(2, (vibCents / 1200) * Math.sin(2 * Math.PI * vibHz * t))
}
