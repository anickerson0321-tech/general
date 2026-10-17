import { describe, expect, it } from 'vitest'
import type { MelodyNote, MusicalKey } from '../../types'
import { analyzePitch, describeLevel, integratedLoudness, levelParams, polishVocal, truePeak } from '../index'
import type { PitchTrack } from '../index'
import { detectMarks, psolaShift } from '../psola'
import { prepareTrack } from '../track'
import { synthF0At, synthVoice } from './synthVoice'
import type { SynthOptions } from './synthVoice'
import { centsVs, med, mono, stats } from './helpers'
import { makeRng } from '../util'

const SR = 48000
const A_MINOR: MusicalKey = { tonic: 9, mode: 'minor' }

/** A4 sung 40 cents sharp, two phrases, vibrato, consonants, a little room noise. */
const DETUNED: SynthOptions = {
  sr: SR,
  duration: 3.6,
  notes: [
    { start: 0.25, end: 1.6, midi: 69.4 },
    { start: 1.85, end: 3.4, midi: 69.4, scoop: 0.8 },
  ],
  vibratoCents: 35,
  consonants: true,
  noiseFloor: 0.002,
}
const detuned = synthVoice(DETUNED)
const detunedAnalysis = analyzePitch({ sampleRate: SR, data: detuned })
/** cents relative to A4 (440) measured on the sustained parts */
function errVsA4(y: Float32Array): number {
  const e = centsVs(y, SR, (t) => (synthF0At(DETUNED, t, false) === synthF0At(DETUNED, t, false) ? 440 : NaN))
  return med(e)
}

describe('polishVocal basics', () => {
  it('amount 0 returns the input bit-identical on both channels', () => {
    const out = polishVocal({ sampleRate: SR, data: detuned }, { amount: 0 })
    expect(out.sampleRate).toBe(SR)
    expect(out.left.length).toBe(detuned.length)
    expect(out.left).not.toBe(detuned)
    for (let i = 0; i < detuned.length; i++) {
      if (out.left[i] !== detuned[i] || out.right[i] !== detuned[i]) throw new Error(`differs at ${i}`)
    }
  })

  for (const amount of [3, 15, 25, 35, 50, 62, 75, 88, 100]) {
    it(`amount ${amount}: stereo, same length, finite, |x| <= 1`, () => {
      const out = polishVocal({ sampleRate: SR, data: detuned }, { amount, key: A_MINOR, analysis: detunedAnalysis })
      expect(out.left.length).toBe(detuned.length)
      expect(out.right.length).toBe(detuned.length)
      for (const ch of [out.left, out.right]) {
        const s = stats(ch)
        expect(s.bad).toBe(0)
        expect(s.peak).toBeLessThanOrEqual(1)
        expect(s.peak).toBeGreaterThan(0.01)
      }
    })
  }

  it('survives silence, NaN/Inf, clipping and very short input', () => {
    const cases: Float32Array[] = [
      new Float32Array(SR),
      new Float32Array(SR).map((_, i) => (i % 97 === 0 ? NaN : i % 89 === 0 ? Infinity : 0.1 * Math.sin(i / 20))),
      new Float32Array(SR).map((_, i) => (Math.sin((2 * Math.PI * 220 * i) / SR) > 0 ? 1 : -1)),
      new Float32Array(300).map(() => 0.2),
      new Float32Array(0),
    ]
    for (const data of cases) {
      for (const amount of [0, 40, 100]) {
        const out = polishVocal({ sampleRate: SR, data }, { amount, robotic: amount === 100 })
        expect(out.left.length).toBe(data.length)
        for (const ch of [out.left, out.right]) {
          const s = stats(ch)
          expect(s.bad).toBe(0)
          expect(s.peak).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('handles a noisy phone-style recording with music bleed', () => {
    const rng = makeRng(3)
    const voice = synthVoice({ ...DETUNED, noiseFloor: 0.02, seed: 9 })
    // "speaker bleed": a quiet chord with drums-ish noise bursts
    const bleed = new Float32Array(voice.length)
    for (let i = 0; i < bleed.length; i++) {
      const t = i / SR
      bleed[i] =
        0.03 * (Math.sin(2 * Math.PI * 130.8 * t) + Math.sin(2 * Math.PI * 164.8 * t) + Math.sin(2 * Math.PI * 196 * t)) +
        (t % 0.5 < 0.03 ? 0.05 * (rng() * 2 - 1) : 0)
    }
    const data = voice.map((v, i) => v + bleed[i])
    for (const amount of [20, 60, 100]) {
      const out = polishVocal({ sampleRate: SR, data }, { amount, key: A_MINOR })
      for (const ch of [out.left, out.right]) {
        const s = stats(ch)
        expect(s.bad).toBe(0)
        expect(s.peak).toBeLessThanOrEqual(1)
      }
    }
  })

  it('keeps the lead sample-aligned with the input (no latency)', () => {
    const bestLag = (a: Float32Array, b: Float32Array, maxLag: number, step: number): number => {
      const i0 = Math.round(0.3 * SR)
      const i1 = Math.round(3.3 * SR)
      let best = -Infinity
      let arg = 0
      for (let lag = -maxLag; lag <= maxLag; lag += step) {
        let s = 0
        for (let i = i0; i < i1; i += 2) s += a[i] * b[i + lag]
        if (s > best) {
          best = s
          arg = lag
        }
      }
      return arg
    }
    // waveform alignment where no pitch shifting happens
    const low = polishVocal({ sampleRate: SR, data: detuned }, { amount: 12, analysis: detunedAnalysis })
    expect(Math.abs(bestLag(detuned, mono(low.left, low.right), 200, 1))).toBeLessThanOrEqual(3)
    // full chain incl. pitch correction, gate look-ahead and limiter: a click marker must not move
    const plain = synthVoice({ ...DETUNED, consonants: false })
    const clickAt = Math.round(3.5 * SR)
    plain[clickAt] = 0.9
    const hi = polishVocal({ sampleRate: SR, data: plain }, { amount: 75, key: A_MINOR })
    const out = mono(hi.left, hi.right)
    let arg = 0
    let pk = 0
    for (let i = clickAt - 480; i <= clickAt + 480; i++) {
      if (Math.abs(out[i]) > pk) {
        pk = Math.abs(out[i])
        arg = i
      }
    }
    expect(Math.abs(arg - clickAt)).toBeLessThanOrEqual(2)
  })

  it('reports monotonic progress ending at 1', () => {
    const calls: number[] = []
    polishVocal({ sampleRate: SR, data: detuned }, { amount: 80 }, (f) => calls.push(f))
    expect(calls.length).toBeGreaterThan(4)
    for (let i = 1; i < calls.length; i++) expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1] - 1e-9)
    expect(calls[calls.length - 1]).toBe(1)
  })
})

describe('pitch correction', () => {
  it('input is ~40 cents sharp', () => {
    expect(errVsA4(detuned)).toBeGreaterThan(35)
    expect(errVsA4(detuned)).toBeLessThan(45)
  })

  it('amount 100 lands within 8 cents of A4 (key A minor)', () => {
    const out = polishVocal({ sampleRate: SR, data: detuned }, { amount: 100, key: A_MINOR, analysis: detunedAnalysis })
    expect(Math.abs(errVsA4(out.left))).toBeLessThan(8)
  })

  it('amount 30 partially corrects; error decreases monotonically with amount', () => {
    const errs = [30, 50, 75, 100].map((amount) => {
      const out = polishVocal({ sampleRate: SR, data: detuned }, { amount, key: A_MINOR, analysis: detunedAnalysis })
      return errVsA4(out.left)
    })
    expect(errs[0]).toBeLessThan(36)
    expect(errs[0]).toBeGreaterThan(10)
    for (let i = 1; i < errs.length; i++) expect(errs[i]).toBeLessThan(errs[i - 1])
  })

  it('works without a key (chromatic snapping)', () => {
    const out = polishVocal({ sampleRate: SR, data: detuned }, { amount: 100, analysis: detunedAnalysis })
    expect(Math.abs(errVsA4(out.left))).toBeLessThan(8)
  })

  it('keeps natural vibrato at Studio, reduces (not removes) it at Perfect, flattens it when robotic', () => {
    const depth = (y: Float32Array): number => {
      // std-dev of cents around the per-note median over the sustained part of note 1
      const e = centsVs(y, SR, () => 440, 0.75, 1.5)
      const m = med(e)
      return Math.sqrt(e.reduce((s, v) => s + (v - m) * (v - m), 0) / e.length)
    }
    const d0 = depth(detuned)
    const d50 = depth(polishVocal({ sampleRate: SR, data: detuned }, { amount: 50, key: A_MINOR, analysis: detunedAnalysis }).left)
    const d100 = depth(polishVocal({ sampleRate: SR, data: detuned }, { amount: 100, key: A_MINOR, analysis: detunedAnalysis }).left)
    const dRobot = depth(
      polishVocal({ sampleRate: SR, data: detuned }, { amount: 75, key: A_MINOR, analysis: detunedAnalysis, robotic: true }).left,
    )
    expect(d0).toBeGreaterThan(15)
    expect(d50).toBeGreaterThan(0.8 * d0)
    expect(d100).toBeLessThan(0.85 * d0)
    expect(d100).toBeGreaterThan(0.3 * d0)
    expect(dRobot).toBeLessThan(0.35 * d0)
  })

  it('follows a target melody (priority over key), folding octaves', () => {
    // singer holds a steady A (+30c) for 2 s; melody says A4 then B4
    for (const singerMidi of [69.3, 57.3]) {
      const opts: SynthOptions = {
        sr: SR,
        duration: 2.6,
        notes: [{ start: 0.2, end: 2.4, midi: singerMidi }],
        vibratoCents: 20,
      }
      const x = synthVoice(opts)
      const melody: MelodyNote[] = [
        { start: 10.2, end: 11.3, midi: 69 },
        { start: 11.3, end: 12.4, midi: 71 },
      ]
      const out = polishVocal({ sampleRate: SR, data: x }, { amount: 100, key: A_MINOR, targetMelody: melody, takeOffsetSec: 10 })
      const base = singerMidi > 60 ? 440 : 220
      const e1 = med(centsVs(out.left, SR, () => base, 0.5, 1.1))
      const e2 = med(centsVs(out.left, SR, () => base * Math.pow(2, 2 / 12), 1.5, 2.3))
      expect(Math.abs(e1)).toBeLessThan(10)
      expect(Math.abs(e2)).toBeLessThan(12)
    }
  })

  it('falls back to the key scale when the melody is far from what was sung', () => {
    const opts: SynthOptions = { sr: SR, duration: 2, notes: [{ start: 0.2, end: 1.8, midi: 69.35 }], vibratoCents: 20 }
    const x = synthVoice(opts)
    // D#5 is 6 semitones away from A4 (and from A5/A3 after folding) → ignored
    const melody: MelodyNote[] = [{ start: 0, end: 2, midi: 75 }]
    const out = polishVocal({ sampleRate: SR, data: x }, { amount: 100, key: A_MINOR, targetMelody: melody })
    expect(Math.abs(med(centsVs(out.left, SR, () => 440, 0.4, 1.6)))).toBeLessThan(8)
  })

  it('follows a guide-vocal pitch track when no melody is given', () => {
    const opts: SynthOptions = { sr: SR, duration: 2, notes: [{ start: 0.2, end: 1.8, midi: 69.3 }], vibratoCents: 20 }
    const x = synthVoice(opts)
    const hop = 0.01
    const nF = Math.round(30 / hop)
    const guide: PitchTrack = { sampleRate: SR, hopSec: hop, f0: new Float32Array(nF), confidence: new Float32Array(nF) }
    for (let f = 0; f < nF; f++) {
      const t = f * hop
      if (t >= 20 && t < 22) {
        guide.f0[f] = 466.16 * Math.pow(2, (0.2 / 12) * Math.sin(2 * Math.PI * 5 * t)) // A#4 with vibrato
        guide.confidence[f] = 0.95
      }
    }
    const out = polishVocal({ sampleRate: SR, data: x }, { amount: 100, guideTrack: guide, takeOffsetSec: 20 })
    expect(Math.abs(med(centsVs(out.left, SR, () => 466.16, 0.4, 1.6)))).toBeLessThan(10)
  })

  it('formantPreserve=false still corrects pitch', () => {
    const out = polishVocal(
      { sampleRate: SR, data: detuned },
      { amount: 100, key: A_MINOR, analysis: detunedAnalysis, formantPreserve: false },
    )
    expect(Math.abs(errVsA4(out.left))).toBeLessThan(10)
  })
})

describe('PSOLA engine', () => {
  const opts: SynthOptions = {
    sr: SR,
    duration: 2,
    notes: [
      { start: 0.1, end: 0.9, midi: 64 },
      { start: 1.0, end: 1.9, midi: 67 },
    ],
    vibratoCents: 30,
    consonants: true,
  }
  const x = synthVoice(opts)
  const ct = prepareTrack(analyzePitch({ sampleRate: SR, data: x }))
  const marks = detectMarks(x, SR, ct.f0, ct.hopSec)

  it('places one mark per period', () => {
    for (const seg of marks.segments) {
      for (let k = 1; k < seg.marks.length; k++) {
        const t = seg.marks[k] / SR
        const P = SR / synthF0At(opts, t)
        const d = seg.marks[k] - seg.marks[k - 1]
        if (P === P) {
          expect(d).toBeGreaterThan(0.75 * P)
          expect(d).toBeLessThan(1.25 * P)
        }
      }
    }
  })

  it('zero shift is an exact pass-through; unvoiced audio is untouched', () => {
    const y0 = psolaShift(x, marks, { shift: new Float32Array(ct.n), hopSec: ct.hopSec })
    expect(Array.from(y0).every((v, i) => v === x[i])).toBe(true)
    const shift = new Float32Array(ct.n).fill(1)
    const y = psolaShift(x, marks, { shift, hopSec: ct.hopSec })
    // consonant hiss right before note 2 (unvoiced) must be identical
    const a = Math.round(0.935 * SR)
    const b = Math.round(0.985 * SR)
    let same = 0
    for (let i = a; i < b; i++) if (y[i] === x[i]) same++
    expect(same / (b - a)).toBeGreaterThan(0.9)
  })

  it('shifts by the requested amount and is click-free under fast-changing ratios', () => {
    const shift = new Float32Array(ct.n)
    for (let f = 0; f < ct.n; f++) shift[f] = Math.floor((f * ct.hopSec) / 0.1) % 2 === 0 ? 1 : -1
    const y = psolaShift(x, marks, { shift, hopSec: ct.hopSec })
    // max sample-to-sample jump should stay in the range of the original signal's
    let jx = 0
    let jy = 0
    for (let i = 1; i < x.length; i++) {
      jx = Math.max(jx, Math.abs(x[i] - x[i - 1]))
      jy = Math.max(jy, Math.abs(y[i] - y[i - 1]))
    }
    expect(jy).toBeLessThan(1.6 * jx)
    const up = psolaShift(x, marks, { shift: new Float32Array(ct.n).fill(2), hopSec: ct.hopSec })
    const e = centsVs(up, SR, (t) => synthF0At(opts, t, false) * Math.pow(2, 2 / 12))
    expect(Math.abs(med(e))).toBeLessThan(8)
  })
})

describe('levels and loudness', () => {
  it('Perfect is loudness-normalised near -14 LUFS with a -1 dBTP ceiling', () => {
    for (const gain of [0.05, 1]) {
      const data = detuned.map((v) => v * gain)
      const out = polishVocal({ sampleRate: SR, data }, { amount: 100, key: A_MINOR })
      const lufs = integratedLoudness([out.left, out.right], SR)
      expect(Math.abs(lufs - -14)).toBeLessThan(1)
      expect(20 * Math.log10(truePeak([out.left, out.right]))).toBeLessThanOrEqual(-0.9)
    }
  })

  it('low amounts keep the take near its original loudness', () => {
    const inL = integratedLoudness([detuned, detuned], SR)
    const out = polishVocal({ sampleRate: SR, data: detuned }, { amount: 8, analysis: detunedAnalysis })
    expect(Math.abs(integratedLoudness([out.left, out.right], SR) - inL)).toBeLessThan(1.5)
  })

  it('a tiny amount sounds almost like the raw take (continuity at 0)', () => {
    const out = polishVocal({ sampleRate: SR, data: detuned }, { amount: 0.5, analysis: detunedAnalysis })
    let num = 0
    let den = 0
    for (let i = 0; i < detuned.length; i++) {
      const d = out.left[i] - detuned[i]
      num += d * d
      den += detuned[i] * detuned[i]
    }
    expect(10 * Math.log10(num / den)).toBeLessThan(-12)
  })

  it('levelParams changes smoothly and in the expected direction', () => {
    const keys: Array<keyof ReturnType<typeof levelParams>> = [
      'pitchStrength',
      'retuneMs',
      'reverbMix',
      'compRatio',
      'deEssDb',
      'gateRangeDb',
      'doubleMix',
      'targetLufs',
      'limiterCeilingDb',
    ]
    let prev = levelParams(0)
    for (let a = 0.5; a <= 100; a += 0.5) {
      const cur = levelParams(a)
      for (const k of keys) {
        const span = Math.max(1e-9, Math.abs((levelParams(100)[k] as number) - (levelParams(0)[k] as number)), 1)
        expect(Math.abs((cur[k] as number) - (prev[k] as number)) / span).toBeLessThan(0.08)
      }
      prev = cur
    }
    const s = levelParams(55)
    expect(s.pitchStrength).toBeGreaterThan(0.6)
    expect(s.pitchStrength).toBeLessThan(0.8)
    expect(s.retuneMs).toBeGreaterThan(30)
    expect(s.retuneMs).toBeLessThan(60)
    const r = levelParams(80)
    expect(r.pitchStrength).toBeGreaterThan(0.85)
    expect(r.retuneMs).toBeLessThanOrEqual(20)
    expect(r.parallelMix).toBeGreaterThan(0)
    const w = levelParams(30)
    expect(w.compRatio).toBeGreaterThan(2)
    expect(w.pitchStrength).toBeLessThan(0.4)
    expect(w.retuneMs).toBeGreaterThan(100)
    expect(levelParams(100).pitchStrength).toBe(1)
    expect(levelParams(0).summary.find((x) => x.id === 'pitch')?.percent).toBe(0)
  })

  it('describeLevel names the stages', () => {
    expect(describeLevel(0).name).toBe('Raw')
    expect(describeLevel(15).name).toBe('Clean')
    expect(describeLevel(35).name).toBe('Warm')
    expect(describeLevel(55).name).toBe('Studio')
    expect(describeLevel(75).name).toBe('Radio')
    expect(describeLevel(95).name).toBe('Perfect')
    expect(describeLevel(NaN).name).toBe('Raw')
  })
})
