// Synthesised instruments. Each note is rendered into a scratch buffer and mixed into a Bus
// (stereo dry + mono reverb/delay sends), so cost is proportional to the notes played.
import { Biquad, Noise, OnePole, Resonator, SR, Svf, TWO_PI, midiToHz, polyBlep, sinT } from './dsp'

export const MAX_NOTE = SR * 12
export const scrA = new Float32Array(MAX_NOTE)
export const scrB = new Float32Array(MAX_NOTE)
const scrC = new Float32Array(MAX_NOTE)

export function softclip(x: number): number {
  if (x > 3) return 1
  if (x < -3) return -1
  const x2 = x * x
  return (x * (27 + x2)) / (27 + 9 * x2)
}

export class Bus {
  readonly n: number
  readonly L: Float32Array
  readonly R: Float32Array
  readonly rev: Float32Array
  readonly dly: Float32Array
  /** control-rate (every 64 samples) ducking gain, or null */
  duck: Float32Array | null = null
  readonly energy: Record<string, number> = {}
  constructor(n: number) {
    this.n = n
    this.L = new Float32Array(n)
    this.R = new Float32Array(n)
    this.rev = new Float32Array(n)
    this.dly = new Float32Array(n)
  }
  /** Mix a mono source into the bus. pan -1..1 */
  add(src: Float32Array, len: number, start: number, gain: number, pan: number, rev: number, dly: number, duck = false, tag = ''): void {
    const s0 = Math.max(0, start)
    const off = s0 - start
    const end = Math.min(this.n, start + len)
    if (end <= s0) return
    const th = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4
    const gl = Math.cos(th) * Math.SQRT2 * gain
    const gr = Math.sin(th) * Math.SQRT2 * gain
    const rv = rev * gain
    const dl = dly * gain
    const L = this.L
    const R = this.R
    const RV = this.rev
    const DL = this.dly
    const dk = duck ? this.duck : null
    let e = 0
    for (let i = s0, j = off; i < end; i++, j++) {
      let x = src[j]
      if (dk) x *= dk[i >> 6]
      L[i] += x * gl
      R[i] += x * gr
      if (rv !== 0) RV[i] += x * rv
      if (dl !== 0) DL[i] += x * dl
      e += x * x
    }
    if (tag) this.energy[tag] = (this.energy[tag] ?? 0) + e * gain * gain
  }
  /** Mix with a slow auto-pan (tremolo-ish stereo movement) */
  addAutoPan(src: Float32Array, len: number, start: number, gain: number, rate: number, depth: number, rev: number, dly: number, tag = ''): void {
    const s0 = Math.max(0, start)
    const end = Math.min(this.n, start + len)
    const inc = rate / SR
    let e = 0
    for (let i = s0, j = s0 - start; i < end; i++, j++) {
      const x = src[j] * gain
      const p = sinT(i * inc) * depth
      const gl = 1 - p
      const gr = 1 + p
      this.L[i] += x * gl
      this.R[i] += x * gr
      this.rev[i] += x * rev
      this.dly[i] += x * dly
      e += x * x
    }
    if (tag) this.energy[tag] = (this.energy[tag] ?? 0) + e
  }
}

export function sec2s(t: number): number {
  return Math.round(t * SR)
}

function clear(buf: Float32Array, len: number): void {
  buf.fill(0, 0, Math.min(len, buf.length))
}

// ============================================================ bass
export type BassKind = 'sub' | '808' | 'synth' | 'picked' | 'upright'

export interface BassNote {
  t: number
  dur: number
  midi: number
  vel: number
  glideFrom?: number
}

export function renderBass(bus: Bus, kind: BassKind, n: BassNote, gain: number, duck: boolean, noiseSeed: number, bright: number): void {
  const f = midiToHz(n.midi)
  const rel = kind === '808' ? 0.06 : kind === 'picked' || kind === 'upright' ? 0.05 : 0.03
  const len = Math.min(MAX_NOTE, Math.ceil((n.dur + rel) * SR))
  const buf = scrA
  clear(buf, len)
  const durS = n.dur * SR
  const relS = rel * SR
  if (kind === 'sub' || kind === '808') {
    let ph = 0
    const f0 = n.glideFrom !== undefined ? midiToHz(n.glideFrom) : f
    const decay = kind === '808' ? Math.max(0.5, Math.min(2.2, n.dur * 1.2)) : 3
    const drive = kind === '808' ? 2.4 : 1.4
    for (let i = 0; i < len; i++) {
      const t = i / SR
      let ff = f
      if (n.glideFrom !== undefined) {
        const g = Math.min(1, t / 0.09)
        ff = f0 * Math.pow(f / f0, g * g * (3 - 2 * g))
      }
      if (kind === '808') ff *= 1 + 0.5 * Math.exp(-t / 0.018)
      ph += ff / SR
      const att = Math.min(1, i / (kind === '808' ? 60 : 120))
      let env = att * Math.exp(-t / decay)
      if (i > durS) env *= Math.max(0, 1 - (i - durS) / relS)
      const s = sinT(ph) + 0.12 * sinT(ph * 2)
      buf[i] = softclip(s * drive * env) * 0.8
    }
  } else if (kind === 'synth') {
    let p1 = 0
    let p2 = 0.3
    let ps = 0
    const svf = new Svf()
    const dt1 = f / SR
    const dt2 = (f * 1.006) / SR
    const base = 180 + bright * 500
    for (let i = 0; i < len; i++) {
      if ((i & 31) === 0) {
        const t = i / SR
        svf.set(base + (900 + bright * 1500) * n.vel * Math.exp(-t / 0.14) + f * 2, 1.1)
      }
      p1 += dt1
      if (p1 >= 1) p1 -= 1
      p2 += dt2
      if (p2 >= 1) p2 -= 1
      ps += dt1 * 0.5
      if (ps >= 1) ps -= 1
      const s1 = 2 * p1 - 1 - polyBlep(p1, dt1)
      const s2 = 2 * p2 - 1 - polyBlep(p2, dt2)
      const sub = sinT(ps)
      let env = Math.min(1, i / 40)
      if (i > durS) env *= Math.max(0, 1 - (i - durS) / relS)
      const x = svf.process((s1 + s2) * 0.4) + sub * 0.55
      buf[i] = softclip(x * 1.3) * env * 0.75
    }
  } else {
    // Karplus-Strong bass with sine reinforcement
    const up = kind === 'upright'
    ks(buf, len, f, n.vel, up ? 0.25 : 0.4 + bright * 0.2, up ? 1.0 : 2.0, durS, relS, noiseSeed, up ? 0.5 : 0.45)
    let ph = 0
    const lp = new OnePole()
    lp.setLp(up ? 900 : 1600 + bright * 1200)
    for (let i = 0; i < len; i++) {
      ph += f / SR
      let env = Math.min(1, i / 60) * Math.exp(-i / SR / (up ? 0.9 : 1.6))
      if (i > durS) env *= Math.max(0, 1 - (i - durS) / relS)
      buf[i] = softclip(lp.lp(buf[i] * 1.2) + sinT(ph) * 0.55 * env) * 0.85
    }
  }
  bus.add(buf, len, sec2s(n.t), gain, 0, 0, 0, duck, 'bass')
}

/**
 * Karplus-Strong plucked string into buf (additive). bright 0..1, decaySec ~ T60.
 * After `durS` samples the string is damped over relS.
 */
export function ks(buf: Float32Array, len: number, f: number, vel: number, bright: number, decaySec: number, durS: number, relS: number, seed: number, pickPos = 0.2, amp = 1): void {
  const brightLoop = 0.35 + bright * 0.6
  const D = Math.max(2, SR / f - (1 - brightLoop))
  const N = Math.max(2, Math.floor(D) + 2)
  const line = scrC
  const frac = D - Math.floor(D)
  const di = Math.floor(D)
  const noise = new Noise(seed)
  // excitation: filtered noise with a pick-position comb
  const lpA = 0.15 + (1 - bright) * 0.75
  let z = 0
  const exc = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    z = noise.next() * (1 - lpA) + z * lpA
    exc[i] = z
  }
  const pp = Math.max(1, Math.floor(N * pickPos))
  for (let i = N - 1; i >= pp; i--) exc[i] -= exc[i - pp] * 0.8
  let mean = 0
  for (let i = 0; i < N; i++) mean += exc[i]
  mean /= N
  let peak = 1e-9
  for (let i = 0; i < N; i++) {
    exc[i] -= mean
    peak = Math.max(peak, Math.abs(exc[i]))
  }
  const g0 = Math.pow(10, -3 / (decaySec * f))
  const ring = N + 2
  for (let i = 0; i < ring; i++) line[i] = 0
  let w = 0
  let last = 0
  const scaleExc = (vel * amp) / peak
  const g = g0
  for (let i = 0; i < len; i++) {
    const fade = i > durS ? Math.max(0, 1 - (i - durS) / relS) : 1
    // read delayed sample (fractional)
    let r1 = w - di
    if (r1 < 0) r1 += ring
    let r2 = r1 - 1
    if (r2 < 0) r2 += ring
    const y = line[r1] * (1 - frac) + line[r2] * frac
    // loop filter: one-zero average blended by brightness
    const yf = y * brightLoop + last * (1 - brightLoop)
    last = y
    const input = i < N ? exc[i] * scaleExc : 0
    line[w] = input + yf * g
    w++
    if (w >= ring) w = 0
    buf[i] += y * fade
  }
}

// ============================================================ keys
export interface KeyNote {
  t: number
  dur: number
  midi: number
  vel: number
}

export function renderPiano(bus: Bus, n: KeyNote, gain: number, pan: number, rev: number, bright: number, tag = 'piano'): void {
  const f = midiToHz(n.midi)
  const Tbase = Math.max(0.7, Math.min(7, 4.2 * Math.pow(261 / f, 0.55)))
  const durTot = Math.min(n.dur + 0.18, Tbase * 2.2)
  const len = Math.min(MAX_NOTE, Math.ceil(durTot * SR))
  const buf = scrA
  clear(buf, len)
  const P = Math.max(2, Math.min(12, Math.floor(9500 / f)))
  const B = 0.00012 * (1 + f / 400)
  const bri = 1.75 - 0.75 * n.vel - bright * 0.35
  const relStart = n.dur * SR
  const relA = Math.exp(-1 / (0.09 * SR))
  for (let p = 1; p <= P; p++) {
    const fp = p * f * Math.sqrt(1 + B * p * p)
    if (fp > SR * 0.45) break
    const w = (TWO_PI * fp) / SR
    const k = 2 * Math.cos(w)
    let y1 = 0
    let y2 = -Math.sin(w) // so first output = sin(w*1)
    let amp = 1 / Math.pow(p, bri)
    if (p === 1) amp *= 0.9
    // hammer position comb (strike at 1/8 of string)
    amp *= 0.35 + 0.65 * Math.abs(Math.sin((Math.PI * p) / 7.3))
    const tau2 = Tbase / (1 + 0.45 * (p - 1))
    const tau1 = tau2 * 0.16
    const d1 = Math.exp(-1 / (tau1 * SR))
    const d2 = Math.exp(-1 / (tau2 * SR))
    let e1 = amp * 0.55
    let e2 = amp * 0.45
    let rel = 1
    for (let i = 0; i < len; i++) {
      const y = k * y1 - y2
      y2 = y1
      y1 = y
      e1 *= d1
      e2 *= d2
      if (i > relStart) rel *= relA
      buf[i] += y * (e1 + e2) * rel
    }
  }
  // hammer thump
  const nz = new Noise(n.midi * 7919 + 13)
  const lp = new OnePole()
  lp.setLp(1200 + n.vel * 2500)
  const hl = Math.min(len, Math.round(0.012 * SR))
  for (let i = 0; i < hl; i++) buf[i] += lp.lp(nz.next()) * 0.25 * n.vel * (1 - i / hl)
  // attack smoothing
  for (let i = 0; i < Math.min(len, 40); i++) buf[i] *= i / 40
  bus.add(buf, len, sec2s(n.t), gain * n.vel * 0.5, pan, rev, 0, false, tag)
}

export function renderEPiano(bus: Bus, n: KeyNote, gain: number, pan: number, rev: number, wobble: number, tag = 'epiano'): void {
  const f = midiToHz(n.midi)
  const tau = Math.max(0.6, Math.min(3.5, 2.2 * Math.pow(261 / f, 0.4)))
  const len = Math.min(MAX_NOTE, Math.ceil(Math.min(n.dur + 0.25, tau * 3) * SR))
  const buf = scrA
  clear(buf, len)
  let pc = 0
  let pm = 0
  let pt = 0
  const relS = n.dur * SR
  const relA = Math.exp(-1 / (0.12 * SR))
  let rel = 1
  const I0 = 0.4 + 1.6 * n.vel
  for (let i = 0; i < len; i++) {
    const t = i / SR
    const wob = wobble > 0 ? 1 + wobble * 0.0025 * sinT(t * 0.6 + n.midi * 0.13) : 1
    pm += (f * wob) / SR
    pc += (f * wob) / SR
    pt += (f * 7.02) / SR
    const I = I0 * Math.exp(-t / 0.22) + 0.22
    const env = (0.65 * Math.exp(-t / (tau * 0.35)) + 0.35 * Math.exp(-t / tau)) * Math.min(1, i / 30)
    if (i > relS) rel *= relA
    const s = sinT(pc + (I * sinT(pm)) / TWO_PI) + 0.12 * n.vel * sinT(pt) * Math.exp(-t / 0.03)
    buf[i] = s * env * rel
  }
  bus.addAutoPan(buf, len, sec2s(n.t), gain * n.vel * 0.42, 4.2, 0.35 * (pan === 0 ? 1 : 0.5), rev, 0, tag)
}

export function renderOrgan(bus: Bus, notes: KeyNote[], gain: number, pan: number, rev: number, perc: boolean, tag = 'organ'): void {
  if (!notes.length) return
  const t0 = Math.min(...notes.map((x) => x.t))
  const t1 = Math.max(...notes.map((x) => x.t + x.dur))
  const len = Math.min(MAX_NOTE, Math.ceil((t1 - t0 + 0.06) * SR))
  const buf = scrA
  clear(buf, len)
  const ratios = [0.5, 1, 1.5, 2, 3, 4]
  const amps = [0.55, 1, 0.45, 0.5, 0.22, 0.18]
  for (const n of notes) {
    const f = midiToHz(n.midi)
    const s0 = Math.round((n.t - t0) * SR)
    const nl = Math.min(len - s0, Math.round((n.dur + 0.05) * SR))
    const durS = n.dur * SR
    const ph = new Float64Array(6)
    for (let i = 0; i < nl; i++) {
      const t = (s0 + i) / SR
      const vib = 1 + 0.0035 * sinT(t * 6.3)
      let s = 0
      for (let k = 0; k < 6; k++) {
        ph[k] += (f * ratios[k] * vib) / SR
        s += sinT(ph[k]) * amps[k]
      }
      if (perc) s += sinT(ph[4]) * 0.6 * Math.exp(-i / (0.18 * SR))
      let env = Math.min(1, i / 90)
      if (i > durS) env *= Math.max(0, 1 - (i - durS) / (0.04 * SR))
      buf[s0 + i] += s * env * 0.16
    }
    // key click
    const nz = new Noise(n.midi * 31 + s0)
    for (let i = 0; i < Math.min(nl, 140); i++) buf[s0 + i] += nz.next() * 0.04 * (1 - i / 140)
  }
  for (let i = 0; i < len; i++) buf[i] = softclip(buf[i] * 1.4)
  bus.addAutoPan(buf, len, sec2s(t0), gain, 0.8, 0.3, rev, 0, tag)
  void pan
}

// ============================================================ pads / strings / choir / brass
export type PadKind = 'warm' | 'supersaw' | 'strings' | 'choir' | 'brass'

export interface PadChord {
  t: number
  dur: number
  notes: number[]
  vel: number
}

/** render a sustained chord with per-note stereo oscillators */
export function renderPad(bus: Bus, kind: PadKind, ch: PadChord, gain: number, rev: number, bright: number, duck: boolean, seed: number, opts?: { attack?: number; release?: number; staccato?: boolean }): void {
  const att = opts?.attack ?? (kind === 'brass' ? 0.06 : kind === 'supersaw' ? 0.02 : kind === 'strings' ? 0.35 : 0.4)
  const rel = opts?.release ?? (kind === 'brass' ? 0.15 : kind === 'supersaw' ? 0.25 : 0.6)
  const len = Math.min(MAX_NOTE, Math.ceil((ch.dur + rel) * SR))
  const L = scrA
  const R = scrB
  clear(L, len)
  clear(R, len)
  const durS = ch.dur * SR
  const attS = Math.max(1, att * SR)
  const relS = rel * SR
  const nz = new Noise(seed)
  for (let ni = 0; ni < ch.notes.length; ni++) {
    const f = midiToHz(ch.notes[ni])
    const nOsc = kind === 'supersaw' ? 6 : kind === 'strings' ? 4 : kind === 'brass' ? 2 : 2
    const detune = kind === 'supersaw' ? 0.012 : kind === 'strings' ? 0.006 : kind === 'brass' ? 0.003 : 0.004
    const ph = new Float64Array(nOsc)
    const dts = new Float64Array(nOsc)
    for (let k = 0; k < nOsc; k++) {
      ph[k] = (nz.next() + 1) / 2
      const spread = nOsc === 1 ? 0 : (k / (nOsc - 1)) * 2 - 1
      dts[k] = (f * (1 + spread * detune)) / SR
    }
    const svfL = new Svf()
    const svfR = new Svf()
    const resA = kind === 'choir' ? [new Resonator(), new Resonator(), new Resonator()] : null
    const resB = kind === 'choir' ? [new Resonator(), new Resonator(), new Resonator()] : null
    if (resA && resB) {
      const fm = ch.notes[ni] > 64 ? [800, 1150, 2900] : [650, 1080, 2650]
      const bw = [90, 110, 160]
      for (let k = 0; k < 3; k++) {
        resA[k].set(fm[k], bw[k])
        resB[k].set(fm[k] * 1.03, bw[k])
      }
    }
    const vibPh = nz.next() * 3
    const baseCut = kind === 'warm' ? 600 + bright * 2200 : kind === 'supersaw' ? 2500 + bright * 5000 : kind === 'strings' ? 1800 + bright * 2500 : kind === 'brass' ? 500 : 3000
    const panSpread = ch.notes.length > 1 ? (ni / (ch.notes.length - 1)) * 2 - 1 : 0
    const gl = 0.5 - panSpread * 0.25
    const gr = 0.5 + panSpread * 0.25
    for (let i = 0; i < len; i++) {
      if ((i & 31) === 0) {
        const t = i / SR
        let cut = baseCut * (1 + 0.15 * sinT(t * 0.2 + vibPh))
        if (kind === 'brass') cut = 400 + (1400 + bright * 1800) * ch.vel * Math.min(1, t / 0.08) * (0.65 + 0.35 * Math.exp(-t / 0.3)) + f * 1.5
        if (opts?.staccato) cut = baseCut * (0.4 + 0.8 * Math.exp(-t / 0.08))
        svfL.set(cut, kind === 'brass' ? 0.9 : 0.7)
        svfR.set(cut * 1.02, kind === 'brass' ? 0.9 : 0.7)
      }
      let vib = 1
      if (kind === 'strings' || kind === 'choir') vib = 1 + 0.0035 * sinT(i * (5.2 / SR) + vibPh)
      else if (kind === 'brass') vib = 1 - 0.01 * Math.exp(-i / (0.03 * SR))
      let sl = 0
      let sr = 0
      for (let k = 0; k < nOsc; k++) {
        const dt = dts[k] * vib
        let p = ph[k] + dt
        if (p >= 1) p -= 1
        ph[k] = p
        const s = 2 * p - 1 - polyBlep(p, dt)
        if (k & 1) sr += s
        else sl += s
      }
      let env: number
      if (opts?.staccato) env = Math.min(1, i / 200) * Math.exp(-i / (0.2 * SR))
      else env = i < attS ? i / attS : 1
      if (i > durS) env *= Math.max(0, 1 - (i - durS) / relS)
      let yl: number
      let yr: number
      if (resA && resB) {
        yl = sl
        yr = sr
        for (let k = 0; k < 3; k++) {
          yl = resA[k].process(yl)
          yr = resB[k].process(yr)
        }
        yl *= 0.5
        yr *= 0.5
      } else {
        yl = svfL.process(sl)
        yr = svfR.process(sr)
      }
      L[i] += yl * env * gl
      R[i] += yr * env * gr
    }
  }
  const g = (gain * ch.vel) / Math.sqrt(ch.notes.length)
  bus.add(L, len, sec2s(ch.t), g, -0.75, rev, 0, duck, kind)
  bus.add(R, len, sec2s(ch.t), g, 0.75, rev, 0, duck, kind)
}

// ============================================================ guitars
export type GuitarKind = 'acoustic' | 'clean' | 'nylon' | 'distorted' | 'skank'

export interface Strum {
  t: number
  dur: number
  notes: number[] // low to high
  vel: number
  dir: 1 | -1 // 1 = down (low->high)
  mute?: boolean // palm mute / staccato
}

export function renderStrum(bus: Bus, kind: GuitarKind, s: Strum, gain: number, pan: number, rev: number, seed: number, dly = 0): void {
  const dist = kind === 'distorted'
  const rel = s.mute ? 0.04 : 0.12
  const len = Math.min(MAX_NOTE, Math.ceil((s.dur + rel + 0.05) * SR))
  const buf = scrA
  clear(buf, len)
  const spread = kind === 'skank' ? 0.004 : dist ? 0.006 : kind === 'nylon' ? 0.012 : 0.016
  const order = s.dir === 1 ? s.notes : s.notes.slice().reverse()
  const bright = kind === 'nylon' ? 0.25 : kind === 'acoustic' ? 0.65 : kind === 'skank' ? 0.55 : dist ? 0.8 : 0.6
  const decay = s.mute ? 0.18 : kind === 'nylon' ? 1.6 : dist ? 3 : 2.4
  order.forEach((m, k) => {
    const off = Math.round(k * spread * SR)
    const f = midiToHz(m)
    const sub = buf.subarray(off)
    const durS = Math.max(0, s.dur * SR - off)
    const v = s.vel * (s.dir === -1 ? 0.8 : 1) * (1 - k * 0.04)
    ks(sub, len - off, f, v, bright, decay, durS, rel * SR, seed + k * 101 + m, kind === 'nylon' ? 0.3 : 0.18)
  })
  if (dist) {
    const hp = new Biquad('highpass', 90, 0.7)
    const pre = new Biquad('peak', 800, 0.8, 6)
    const c1 = new Biquad('lowpass', 4200, 0.8)
    const c2 = new Biquad('lowpass', 5500, 0.6)
    const mid = new Biquad('peak', 1700, 1.0, 3)
    const lowCut = new Biquad('peak', 300, 0.7, -3)
    const drive = s.mute ? 9 : 14
    for (let i = 0; i < len; i++) {
      let x = pre.process(hp.process(buf[i]))
      x = softclip(x * drive)
      x = softclip(x * 1.6) * 0.5
      buf[i] = lowCut.process(mid.process(c2.process(c1.process(x))))
    }
  } else {
    const hp = new Biquad('highpass', kind === 'skank' ? 250 : 85, 0.7)
    const body = new Biquad('peak', kind === 'nylon' ? 180 : 210, 1.2, kind === 'acoustic' || kind === 'nylon' ? 4 : 1)
    const pres = new Biquad('peak', kind === 'acoustic' ? 3000 : 2200, 0.9, kind === 'acoustic' ? 3 : 1.5)
    const lp = new Biquad('lowpass', kind === 'nylon' ? 4500 : kind === 'clean' ? 6000 : 9000, 0.7)
    for (let i = 0; i < len; i++) buf[i] = lp.process(pres.process(body.process(hp.process(buf[i])))) * 0.6
  }
  bus.add(buf, len, sec2s(s.t), gain, pan, rev, dly, false, dist ? 'gtr-dist' : 'gtr')
}

// ============================================================ leads (monophonic lines)
export type LeadKind = 'saw' | 'square' | 'pluck' | 'bell' | 'flute' | 'steel' | 'sax' | 'guitar' | 'brass' | 'piano' | 'arp'

export interface LeadNote {
  t: number
  dur: number
  midi: number
  vel: number
}

/** Render a phrase of legato notes as one continuous voice (portamento between notes). */
export function renderLeadPhrase(bus: Bus, kind: LeadKind, notes: LeadNote[], gain: number, pan: number, rev: number, dly: number, bright: number, seed: number): void {
  if (!notes.length) return
  if (kind === 'piano') {
    for (const n of notes) renderPiano(bus, n, gain * 1.6, pan, rev, bright, 'lead')
    return
  }
  if (kind === 'pluck' || kind === 'bell' || kind === 'arp') {
    for (const n of notes) renderPluck(bus, kind, n, gain, pan, rev, dly, bright)
    return
  }
  const t0 = notes[0].t
  const last = notes[notes.length - 1]
  const rel = kind === 'steel' ? 0.25 : 0.08
  const len = Math.min(MAX_NOTE, Math.ceil((last.t + last.dur - t0 + rel) * SR))
  const buf = scrA
  clear(buf, len)
  const nz = new Noise(seed)
  const svf = new Svf()
  const r1 = new Resonator()
  const r2 = new Resonator()
  const r3 = new Resonator()
  r1.set(550, 110)
  r2.set(1450, 160)
  r3.set(2600, 220)
  const breathF = new Svf()
  let ph = 0
  let ph2 = 0.25
  let curMidi = notes[0].midi - (kind === 'guitar' || kind === 'sax' ? 1 : 0)
  let ni = 0
  const glide = kind === 'steel' ? 0.12 : kind === 'guitar' ? 0.05 : 0.045
  const vibRate = kind === 'steel' ? 4.2 : kind === 'flute' ? 5 : 5.5
  const vibDepth = kind === 'guitar' ? 0.3 : kind === 'steel' ? 0.12 : kind === 'sax' ? 0.2 : 0.18
  let noteStartS = 0
  let amp = 0
  const endS = (last.t + last.dur - t0) * SR
  const hp = new OnePole()
  hp.setLp(120)
  for (let i = 0; i < len; i++) {
    const t = t0 + i / SR
    while (ni + 1 < notes.length && t >= notes[ni + 1].t) {
      ni++
      noteStartS = i
    }
    const n = notes[ni]
    const target = n.midi
    const sinceS = i - noteStartS
    // portamento
    const gcoef = 1 - Math.exp(-1 / (glide * SR))
    curMidi += (target - curMidi) * gcoef
    const tn = sinceS / SR
    const vibAmt = vibDepth * Math.min(1, Math.max(0, (tn - 0.2) / 0.3))
    const m = curMidi + vibAmt * sinT(t * vibRate)
    const f = 440 * Math.pow(2, (m - 69) / 12)
    const dt = f / SR
    // amplitude: per phrase envelope with gentle accent per note
    const inNote = t < n.t + n.dur
    const targetAmp = inNote ? n.vel * (kind === 'brass' ? 0.8 + 0.2 * Math.exp(-tn / 0.15) : 1) : 0
    const aCoef = targetAmp > amp ? (kind === 'flute' || kind === 'steel' ? 0.0012 : 0.004) : 0.002
    amp += (targetAmp - amp) * aCoef
    let env = amp
    if (i > endS) env *= Math.max(0, 1 - (i - endS) / (rel * SR))
    ph += dt
    if (ph >= 1) ph -= 1
    let s = 0
    switch (kind) {
      case 'saw':
      case 'brass':
      case 'guitar': {
        ph2 += dt * 1.004
        if (ph2 >= 1) ph2 -= 1
        s = 2 * ph - 1 - polyBlep(ph, dt) + 0.6 * (2 * ph2 - 1 - polyBlep(ph2, dt))
        if ((i & 31) === 0) {
          const cut = kind === 'brass' ? 500 + 2200 * env + f * 2 : kind === 'guitar' ? 3200 : f * 4 + 1500 + bright * 2500
          svf.set(cut, kind === 'saw' ? 1.3 : 0.8)
        }
        s = svf.process(s * 0.5)
        if (kind === 'guitar') s = softclip(s * 8) * 0.35
        break
      }
      case 'square': {
        let sq = ph < 0.5 ? 1 : -1
        sq += polyBlep(ph, dt)
        const p2 = ph + 0.5 - Math.floor(ph + 0.5)
        sq -= polyBlep(p2, dt)
        if ((i & 31) === 0) svf.set(f * 3 + 1200 + bright * 2000, 0.9)
        s = svf.process(sq * 0.45)
        break
      }
      case 'flute': {
        s = sinT(ph) + 0.18 * sinT(ph * 2) + 0.06 * sinT(ph * 3)
        if ((i & 31) === 0) breathF.set(f * 2, 2)
        breathF.process(nz.next())
        s = s * 0.55 + breathF.bp * 0.25 * (0.4 + Math.exp(-tn / 0.1))
        break
      }
      case 'steel': {
        s = sinT(ph) + 0.35 * sinT(ph * 2) + 0.18 * sinT(ph * 3) + 0.06 * sinT(ph * 4)
        s *= 0.5
        break
      }
      case 'sax': {
        const saw = 2 * ph - 1 - polyBlep(ph, dt)
        let x = saw * 0.5 + nz.next() * 0.04
        x = r1.process(x) * 0.6 + r2.process(x) * 0.5 + r3.process(x) * 0.25
        s = softclip(x * 1.5) * 0.5
        break
      }
      default:
        s = sinT(ph)
    }
    buf[i] = hp.hp(s) * env
  }
  bus.add(buf, len, sec2s(t0), gain, pan, rev, dly, false, 'lead')
}

export function renderPluck(bus: Bus, kind: 'pluck' | 'bell' | 'arp', n: LeadNote, gain: number, pan: number, rev: number, dly: number, bright: number): void {
  const f = midiToHz(n.midi)
  const decay = kind === 'bell' ? 1.4 : kind === 'arp' ? 0.22 : 0.45
  const len = Math.min(MAX_NOTE, Math.ceil(Math.min(n.dur + decay * 2, decay * 5) * SR))
  const buf = scrA
  clear(buf, len)
  const durS = n.dur * SR
  if (kind === 'bell') {
    let pc = 0
    let pm = 0
    for (let i = 0; i < len; i++) {
      const t = i / SR
      pc += f / SR
      pm += (f * 3.5) / SR
      const I = 2.2 * n.vel * Math.exp(-t / 0.35)
      const env = Math.exp(-t / decay) * Math.min(1, i / 30)
      buf[i] = (sinT(pc + (I * sinT(pm)) / TWO_PI) + 0.25 * sinT(pc * 2.0) * Math.exp(-t / 0.5)) * env * 0.6
    }
  } else {
    let p1 = 0
    let p2 = 0.5
    const svf = new Svf()
    const dt1 = f / SR
    const dt2 = (f * 1.007) / SR
    for (let i = 0; i < len; i++) {
      if ((i & 15) === 0) {
        const t = i / SR
        svf.set(f * 1.5 + (1500 + bright * 5000) * n.vel * Math.exp(-t / (kind === 'arp' ? 0.07 : 0.12)), 1.2)
      }
      p1 += dt1
      if (p1 >= 1) p1 -= 1
      p2 += dt2
      if (p2 >= 1) p2 -= 1
      const s = 2 * p1 - 1 - polyBlep(p1, dt1) + (2 * p2 - 1 - polyBlep(p2, dt2)) * 0.7
      let env = Math.exp(-i / SR / decay) * Math.min(1, i / 25)
      if (i > durS) env *= Math.max(0, 1 - (i - durS) / (0.05 * SR))
      buf[i] = svf.process(s * 0.35) * env
    }
  }
  bus.add(buf, len, sec2s(n.t), gain * n.vel, pan, rev, dly, false, kind === 'arp' ? 'arp' : 'lead')
}

// ============================================================ fx
export function renderRiser(bus: Bus, t: number, dur: number, gain: number, seed: number): void {
  const len = Math.min(MAX_NOTE, Math.ceil(dur * SR))
  const buf = scrA
  clear(buf, len)
  const nz = new Noise(seed)
  const svf = new Svf()
  for (let i = 0; i < len; i++) {
    const x = i / len
    if ((i & 31) === 0) svf.set(300 * Math.pow(30, x), 2.5)
    svf.process(nz.next())
    buf[i] = svf.bp * x * x * 0.8
  }
  bus.add(buf, len, sec2s(t), gain, 0, 0.6, 0.2, false, 'fx')
}

export function renderImpact(bus: Bus, t: number, gain: number, seed: number): void {
  const len = Math.ceil(2.2 * SR)
  const buf = scrA
  clear(buf, len)
  const nz = new Noise(seed)
  const lp = new OnePole()
  lp.setLp(900)
  let ph = 0
  for (let i = 0; i < len; i++) {
    const tt = i / SR
    ph += (38 + 40 * Math.exp(-tt / 0.08)) / SR
    buf[i] = softclip(sinT(ph) * 1.8) * Math.exp(-tt / 0.6) * 0.8 + lp.lp(nz.next()) * Math.exp(-tt / 0.25) * 0.5
  }
  bus.add(buf, len, sec2s(t), gain, 0, 0.5, 0, false, 'fx')
}

export function renderReverseCymbal(bus: Bus, t: number, dur: number, gain: number, seed: number): void {
  const len = Math.min(MAX_NOTE, Math.ceil(dur * SR))
  const buf = scrA
  clear(buf, len)
  const nz = new Noise(seed)
  const hp = new Biquad('highpass', 5000, 0.7)
  for (let i = 0; i < len; i++) {
    const x = i / len
    buf[i] = hp.process(nz.next()) * Math.pow(x, 3) * 0.5
  }
  bus.add(buf, len, sec2s(t - dur), gain, 0.2, 0.4, 0, false, 'fx')
}

/** Vinyl crackle + hiss written straight into the bus over [0, n). */
export function renderVinyl(bus: Bus, gain: number, seed: number): void {
  const nz = new Noise(seed)
  const lp = new OnePole()
  lp.setLp(3500)
  const hp = new OnePole()
  hp.setLp(400)
  let click = 0
  for (let i = 0; i < bus.n; i++) {
    const r = nz.next()
    if (r > 0.9993) click = (nz.next() > 0 ? 1 : -1) * (0.3 + Math.abs(nz.next()))
    const c = click
    click *= 0.6
    const hiss = lp.lp(nz.next()) * 0.05
    const v = hp.hp(c + hiss) * gain
    bus.L[i] += v
    bus.R[i] += v * 0.9
  }
}
