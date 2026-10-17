// "Vocaloid-lite" formant singing synthesiser.
// Rosenberg glottal-flow-derivative source (band-limited closure) with jitter/shimmer and breath noise,
// vibrato that blooms after the onset, portamento, 5-formant cascade filter interpolating between
// vowel targets, and noise-burst consonants.
import { Noise, OnePole, Resonator, SR, Svf, polyBlep, sinT } from './dsp'
import type { Bus } from './instruments'
import { MAX_NOTE, scrB } from './instruments'
import type { VNote } from './model'
import type { Cons, SylPhones, Vowel } from './syllables'

// male formant targets F1..F4 (Hz), slightly "opened" for singing
const VF: Record<Vowel, [number, number, number, number]> = {
  i: [300, 2250, 2950, 3500],
  I: [400, 1950, 2550, 3500],
  e: [540, 1800, 2500, 3500],
  ae: [680, 1700, 2420, 3450],
  a: [750, 1150, 2500, 3400],
  o: [580, 880, 2450, 3350],
  U: [450, 1050, 2300, 3350],
  u: [320, 850, 2250, 3300],
  A: [650, 1200, 2450, 3400],
  R: [500, 1350, 1700, 3300],
  '@': [520, 1450, 2500, 3400],
}
const BW = [75, 95, 150, 220]

type CType = 'stop' | 'fric' | 'nasal' | 'liquid' | 'aff' | 'h'
interface CDef {
  type: CType
  voiced: boolean
  dur: number // seconds
  nf: number // noise centre freq
  nq: number
  na: number // noise amp
  f?: [number, number, number]
  amp?: number
}
const CD: Record<Cons, CDef> = {
  p: { type: 'stop', voiced: false, dur: 0.06, nf: 900, nq: 0.6, na: 0.5 },
  b: { type: 'stop', voiced: true, dur: 0.045, nf: 900, nq: 0.6, na: 0.3 },
  t: { type: 'stop', voiced: false, dur: 0.06, nf: 4500, nq: 1.0, na: 0.55 },
  d: { type: 'stop', voiced: true, dur: 0.045, nf: 4000, nq: 1.0, na: 0.3 },
  k: { type: 'stop', voiced: false, dur: 0.065, nf: 2300, nq: 1.4, na: 0.5 },
  g: { type: 'stop', voiced: true, dur: 0.05, nf: 2100, nq: 1.4, na: 0.3 },
  f: { type: 'fric', voiced: false, dur: 0.085, nf: 5500, nq: 0.5, na: 0.22 },
  v: { type: 'fric', voiced: true, dur: 0.06, nf: 4500, nq: 0.5, na: 0.12 },
  th: { type: 'fric', voiced: false, dur: 0.075, nf: 6500, nq: 0.5, na: 0.14 },
  dh: { type: 'fric', voiced: true, dur: 0.04, nf: 5000, nq: 0.5, na: 0.08 },
  s: { type: 'fric', voiced: false, dur: 0.1, nf: 7200, nq: 2.2, na: 0.42 },
  z: { type: 'fric', voiced: true, dur: 0.075, nf: 6800, nq: 2.2, na: 0.25 },
  sh: { type: 'fric', voiced: false, dur: 0.1, nf: 3100, nq: 1.6, na: 0.42 },
  zh: { type: 'fric', voiced: true, dur: 0.07, nf: 2900, nq: 1.6, na: 0.25 },
  h: { type: 'h', voiced: false, dur: 0.06, nf: 0, nq: 1, na: 0.5 },
  ch: { type: 'aff', voiced: false, dur: 0.08, nf: 3100, nq: 1.6, na: 0.45 },
  j: { type: 'aff', voiced: true, dur: 0.065, nf: 2900, nq: 1.6, na: 0.28 },
  m: { type: 'nasal', voiced: true, dur: 0.07, nf: 0, nq: 1, na: 0, f: [280, 1100, 2350], amp: 0.42 },
  n: { type: 'nasal', voiced: true, dur: 0.065, nf: 0, nq: 1, na: 0, f: [280, 1650, 2600], amp: 0.42 },
  ng: { type: 'nasal', voiced: true, dur: 0.07, nf: 0, nq: 1, na: 0, f: [290, 2000, 2700], amp: 0.38 },
  l: { type: 'liquid', voiced: true, dur: 0.055, nf: 0, nq: 1, na: 0, f: [380, 1150, 2700], amp: 0.7 },
  r: { type: 'liquid', voiced: true, dur: 0.06, nf: 0, nq: 1, na: 0, f: [450, 1200, 1600], amp: 0.72 },
  w: { type: 'liquid', voiced: true, dur: 0.055, nf: 0, nq: 1, na: 0, f: [320, 720, 2300], amp: 0.6 },
  y: { type: 'liquid', voiced: true, dur: 0.05, nf: 0, nq: 1, na: 0, f: [290, 2150, 2950], amp: 0.65 },
}

interface Seg {
  s0: number
  f1: number
  f2: number
  f3: number
  f4: number
  voice: number
  asp: number
  fric: number
  ff: number
  fq: number
  /** fast transition (bursts) */
  fast: boolean
}

export interface VoiceOpts {
  gender: 'male' | 'female'
  breath: number
  seed: number
  /** cents */
  detune: number
  useHarm: boolean
  gain: number
  pan: number
  rev: number
  dly: number
  vibDepth: number
  /** extra formant scaling (1 = natural) */
  formant: number
  tag: string
}

const DEFAULT_SYL: SylPhones = { text: 'ah', onset: [], vowels: ['a'], coda: [], stress: 1 }

function buildSegs(notes: VNote[], t0: number, fs: number[], breath: number): Seg[] {
  const segs: Seg[] = []
  const push = (s0: number, F: number[], voice: number, asp: number, fric = 0, ff = 4000, fq = 1, fast = false) => {
    segs.push({ s0: Math.round(s0), f1: F[0], f2: F[1], f3: F[2], f4: F[3], voice, asp, fric, ff, fq, fast })
  }
  const scaleF = (F: readonly number[]) => [F[0] * fs[0], F[1] * fs[1], F[2] * fs[2], F[3] * fs[3]]
  for (let j = 0; j < notes.length; j++) {
    const n = notes[j]
    const syl = n.syl ?? DEFAULT_SYL
    const nextCont = !!notes[j + 1]?.cont
    const s0 = (n.start - t0) * SR
    const s1 = (n.end - t0) * SR
    const L = Math.max(1, s1 - s0)
    const onset = n.cont ? [] : syl.onset
    const coda = nextCont ? [] : syl.coda
    let vowels: Vowel[] = syl.vowels.length ? syl.vowels : ['@']
    if (nextCont) vowels = [vowels[0]]
    const vF = vowels.map((v) => scaleF(VF[v]))
    const onDur = onset.reduce((a, c) => a + CD[c].dur, 0) * SR
    const coDur = coda.reduce((a, c) => a + CD[c].dur, 0) * SR
    const kOn = onDur > 0 ? Math.min(1, (L * (L < 0.25 * SR ? 0.45 : 0.32)) / onDur) : 1
    const kCo = coDur > 0 ? Math.min(1, (L * 0.28) / coDur) : 1
    let cur = s0
    const firstV = vF[0]
    const lastV = vF[vF.length - 1]
    const consSeg = (c: Cons, d: number, nb: number[], isOnset: boolean) => {
      const cd = CD[c]
      const nf = (cd.f ? [cd.f[0] * fs[0], cd.f[1] * fs[1], cd.f[2] * fs[2], nb[3]] : nb) as number[]
      switch (cd.type) {
        case 'stop': {
          const closure = d * 0.5
          const burst = Math.min(d * 0.25, 0.012 * SR)
          push(cur, nb, cd.voiced ? 0.12 : 0, 0)
          push(cur + closure, nb, cd.voiced ? 0.2 : 0, 0, cd.na, cd.nf, cd.nq, true)
          push(cur + closure + burst, nb, cd.voiced ? 0.6 : 0, cd.voiced ? 0 : isOnset ? 0.45 : 0.15)
          break
        }
        case 'aff': {
          push(cur, nb, cd.voiced ? 0.12 : 0, 0)
          push(cur + d * 0.3, nb, cd.voiced ? 0.25 : 0, 0, cd.na, cd.nf, cd.nq)
          break
        }
        case 'fric':
          push(cur, nb, cd.voiced ? 0.35 : 0, 0, cd.na, cd.nf, cd.nq)
          break
        case 'h':
          push(cur, nb, 0, 0.7)
          break
        case 'nasal':
        case 'liquid':
          push(cur, nf, cd.amp ?? 0.6, 0)
          break
      }
    }
    if (n.cont) {
      // continuing vowel: glide to the final vowel target
      push(cur, firstV, 1, breath * 0.2)
    } else {
      for (const c of onset) {
        const d = CD[c].dur * SR * kOn
        consSeg(c, d, firstV, true)
        cur += d
      }
    }
    const codaLen = coDur * kCo
    const vEnd = s1 - codaLen
    const vLen = Math.max(1, vEnd - cur)
    if (vF.length === 1) push(cur, vF[0], 1, breath * 0.2)
    else if (vF.length === 2) {
      push(cur, vF[0], 1, breath * 0.2)
      push(cur + vLen * 0.68, vF[1], 1, breath * 0.2)
    } else {
      push(cur, vF[0], 1, breath * 0.2)
      push(cur + vLen * 0.5, vF[1], 1, breath * 0.2)
      push(cur + vLen * 0.78, vF[2], 1, breath * 0.2)
    }
    cur = vEnd
    for (const c of coda) {
      const d = CD[c].dur * SR * kCo
      consSeg(c, d, lastV, false)
      cur += d
    }
  }
  segs.sort((a, b) => a.s0 - b.s0)
  return segs
}

/** Render all phrases of a vocal line into the bus. */
export function renderVoice(bus: Bus, notes: VNote[], o: VoiceOpts): void {
  let start = 0
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    const isEnd = n.phraseEnd || i === notes.length - 1 || n.end - notes[start].start > 10.5
    if (isEnd) {
      renderPhrase(bus, notes.slice(start, i + 1), o, i)
      start = i + 1
    }
  }
}

function renderPhrase(bus: Bus, notes: VNote[], o: VoiceOpts, idx: number): void {
  const t0 = notes[0].start
  const t1 = notes[notes.length - 1].end
  const len = Math.min(MAX_NOTE, Math.max(1, Math.round((t1 - t0) * SR)))
  const buf = scrB
  buf.fill(0, 0, len)
  const fem = o.gender === 'female'
  const fs = fem ? [1.16 * o.formant, 1.14 * o.formant, 1.1 * o.formant, 1.08 * o.formant] : [o.formant, o.formant, o.formant, o.formant]
  const segs = buildSegs(notes, t0, fs, o.breath)
  const nz = new Noise(o.seed * 977 + idx * 131 + 7)
  const res = [new Resonator(), new Resonator(), new Resonator(), new Resonator(), new Resonator()]
  const f5 = fem ? 4900 : 4300
  res[4].set(f5, 300)
  const fric = new Svf()
  const hp = new OnePole()
  hp.setLp(fem ? 140 : 95)
  const lp = new OnePole()
  lp.setLp(fem ? 9500 : 8500)
  // state
  let F1 = segs[0]?.f1 ?? 600
  let F2 = segs[0]?.f2 ?? 1200
  let F3 = segs[0]?.f3 ?? 2500
  let F4 = segs[0]?.f4 ?? 3400
  let vAmp = 0
  let aAmp = 0
  let fAmp = 0
  let si = -1
  let seg: Seg = segs[0]
  let ni = 0
  const noteS0 = notes.map((n) => Math.round((n.start - t0) * SR))
  let prevMidi = notes[0].midi
  let glideFrom = notes[0].midi
  let phase = 0
  let jit = 1
  let shim = 1
  const Tp = 0.42
  const Tn = 0.13 + o.breath * 0.1
  const tc = Tp + Tn
  const eScale = (2 * Tn) / Math.PI
  let norm = 1
  let f0 = 200
  let f0Next = 200
  let drift = 0
  let driftT = 0
  const vibRate = 5.2 + ((o.seed % 7) / 7) * 0.8
  const vibPhase = (o.seed % 13) / 13
  const scoop = notes[0].stress >= 1 && !notes[0].cont ? 0.6 + (o.seed % 3) * 0.15 : 0.25
  const coefF = 1 - Math.exp(-32 / (0.016 * SR))
  const coefV = 1 - Math.exp(-1 / (0.005 * SR))
  const coefA = 1 - Math.exp(-1 / (0.006 * SR))
  const coefFr = 1 - Math.exp(-1 / (0.003 * SR))
  const coefFast = 1 - Math.exp(-1 / (0.0008 * SR))
  const endRel = Math.round(0.07 * SR)
  const attackS = Math.round(0.03 * SR)
  const breathAmt = 0.04 + o.breath * 0.22
  let lastY = 0
  const pitchOf = (n: VNote) => (o.useHarm && n.harm !== undefined ? n.harm : n.midi) + o.detune / 100
  const computeMidi = (i: number): number => {
    const n = notes[ni]
    const tIn = (i - noteS0[ni]) / SR
    const nd = n.end - n.start
    let m = pitchOf(n)
    if (ni > 0 && !n.phraseStart) {
      const gT = Math.min(0.085, nd * 0.35)
      if (tIn < gT) {
        const x = tIn / gT
        m = glideFrom + (m - glideFrom) * (x * x * (3 - 2 * x))
      }
    } else if (ni === 0 && tIn < 0.09) {
      const x = tIn / 0.09
      m -= scoop * (1 - x * x * (3 - 2 * x))
    }
    // vibrato blooms after ~0.25s on longer notes
    const vibT = n.cont ? tIn + 0.3 : tIn
    if (nd > 0.32) {
      const ramp = Math.min(1, Math.max(0, (vibT - 0.22) / 0.35))
      m += o.vibDepth * ramp * sinT((i / SR) * vibRate + vibPhase)
    }
    // phrase-final droop
    if (ni === notes.length - 1 && nd > 0.3) {
      const tl = n.end - n.start - tIn
      if (tl < 0.08) m -= 0.35 * (1 - tl / 0.08)
    }
    return m + drift
  }
  for (let i = 0; i < len; i++) {
    while (ni + 1 < notes.length && i >= noteS0[ni + 1]) {
      prevMidi = pitchOf(notes[ni])
      ni++
      glideFrom = prevMidi
    }
    while (si + 1 < segs.length && i >= segs[si + 1].s0) {
      si++
      seg = segs[si]
    }
    if ((i & 15) === 0) {
      f0 = f0Next
      if (i === 0) f0 = 440 * Math.pow(2, (computeMidi(0) - 69) / 12)
      f0Next = 440 * Math.pow(2, (computeMidi(Math.min(len - 1, i + 16)) - 69) / 12)
    }
    if ((i & 31) === 0) {
      // drift: slow random walk (+-10 cents)
      driftT += 32 / SR
      if (driftT > 0.12) {
        driftT = 0
        drift = drift * 0.7 + nz.next() * 0.05
      }
      if (seg) {
        F1 += (seg.f1 - F1) * coefF
        F2 += (seg.f2 - F2) * coefF
        F3 += (seg.f3 - F3) * coefF
        F4 += (seg.f4 - F4) * coefF
      }
      // formant tuning for high notes: keep F1 above f0
      const f1e = Math.max(F1, f0 * 1.12)
      res[0].set(f1e, BW[0] * (fem ? 1.15 : 1) + f0 * 0.05)
      res[1].set(Math.max(F2, f1e + 250), BW[1] * (fem ? 1.1 : 1))
      res[2].set(F3, BW[2])
      res[3].set(F4, BW[3])
      if ((i & 63) === 0) {
        let p = 0
        for (let h = 1; h <= 8; h++) {
          const fh = f0 * h
          if (fh > SR * 0.45) break
          let g = 1
          for (let k = 0; k < 5; k++) g *= res[k].mag(fh)
          const w = 1 / Math.pow(h, 0.8)
          p += g * g * w * w
        }
        norm = 0.35 / Math.sqrt(p + 1e-9)
      }
      if (seg && seg.fric > 0) fric.set(seg.ff * (fem ? 1.08 : 1), seg.fq)
    }
    const frac = (i & 15) / 16
    const f = (f0 + (f0Next - f0) * frac) * jit
    const dt = f / SR
    phase += dt
    if (phase >= 1) {
      phase -= 1
      jit = 1 + nz.next() * 0.004
      shim = 1 + nz.next() * 0.05
    }
    // glottal flow and its derivative (Rosenberg) with polyBLEP at the closure
    let flow: number
    let e: number
    if (phase < Tp) {
      flow = 0.5 * (1 - sinT(phase / (2 * Tp) + 0.25))
      e = sinT(phase / (2 * Tp)) * (Math.PI / (2 * Tp)) * eScale
    } else if (phase < tc) {
      const x = (phase - Tp) / (4 * Tn)
      flow = sinT(x + 0.25)
      e = -sinT(x) * eScale
    } else {
      flow = 0
      e = 0
    }
    let rel = phase - tc
    if (rel < 0) rel += 1
    e += 0.5 * polyBlep(rel, dt)
    // targets
    const tv = seg ? seg.voice : 0
    const ta = seg ? seg.asp : 0
    const tf = seg ? seg.fric : 0
    vAmp += (tv - vAmp) * coefV
    aAmp += (ta - aAmp) * coefA
    fAmp += (tf - fAmp) * (seg && seg.fast ? coefFast : coefFr)
    const noise = nz.next()
    const src = e * shim * vAmp + noise * (aAmp * 0.35 + vAmp * breathAmt * (0.25 + flow))
    let y = src
    for (let k = 0; k < 5; k++) y = res[k].process(y)
    y *= norm
    // radiation-ish tilt + band limiting
    y = lp.lp(hp.hp(y))
    let fr = 0
    if (fAmp > 1e-4) {
      fric.process(nz.next())
      fr = fric.bp * fAmp
    }
    let env = 1
    if (i < attackS) env = i / attackS
    const toEnd = len - 1 - i
    if (toEnd < endRel) env *= toEnd / endRel
    const n = notes[ni]
    const out = (y + fr * 0.9) * env * (0.8 + 0.25 * n.vel)
    buf[i] = out
    lastY = out
  }
  void lastY
  bus.add(buf, len, Math.round(t0 * SR), o.gain, o.pan, o.rev, o.dly, false, o.tag)
}
