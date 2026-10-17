import { describe, expect, it } from 'vitest'
import { analyzePitch } from '../pitch'
import { harmonicTone, synthF0At, synthVoice, toneF0 } from './synthVoice'
import { med } from './helpers'
import { makeRng } from '../util'

describe('analyzePitch', () => {
  for (const sr of [48000, 44100]) {
    for (const hz of [82.4, 110, 220, 440, 880]) {
      it(`tracks a ${hz} Hz harmonic tone with vibrato @ ${sr} Hz to < 10 cents`, () => {
        const x = harmonicTone(sr, 1.5, hz, 5.5, 35)
        const tr = analyzePitch({ sampleRate: sr, data: x })
        expect(tr.sampleRate).toBe(sr)
        expect(tr.hopSec).toBeGreaterThanOrEqual(0.005)
        expect(tr.hopSec).toBeLessThanOrEqual(0.01)
        const errs: number[] = []
        let voiced = 0
        let total = 0
        for (let f = 5; f < tr.f0.length - 5; f++) {
          total++
          if (tr.f0[f] <= 0) continue
          voiced++
          errs.push(Math.abs(1200 * Math.log2(tr.f0[f] / toneF0(hz, f * tr.hopSec, 5.5, 35))))
        }
        expect(voiced / total).toBeGreaterThan(0.95)
        expect(med(errs)).toBeLessThan(10)
      })
    }
  }

  it('tracks a formant-filtered sung voice with scoops and consonants', () => {
    const sr = 48000
    const opts = {
      sr,
      duration: 3,
      notes: [
        { start: 0.2, end: 1.2, midi: 57 },
        { start: 1.3, end: 2.1, midi: 64, scoop: 1.5 },
        { start: 2.2, end: 2.9, midi: 76 },
      ],
      vibratoCents: 40,
      consonants: true,
      noiseFloor: 0.003,
    }
    const x = synthVoice(opts)
    const tr = analyzePitch({ sampleRate: sr, data: x })
    const errs: number[] = []
    let gross = 0
    for (let f = 0; f < tr.f0.length; f++) {
      const g = synthF0At(opts, f * tr.hopSec)
      if (!(g === g) || tr.f0[f] <= 0) continue
      const c = Math.abs(1200 * Math.log2(tr.f0[f] / g))
      errs.push(c)
      if (c > 100) gross++
    }
    expect(med(errs)).toBeLessThan(10)
    expect(gross / errs.length).toBeLessThan(0.03) // no octave errors to speak of
    // silence between notes is unvoiced
    const gapFrame = Math.round(1.25 / tr.hopSec)
    expect(tr.f0[gapFrame]).toBe(0)
  })

  it('reports silence and white noise as unvoiced', () => {
    const sr = 48000
    const silence = new Float32Array(sr)
    const t1 = analyzePitch({ sampleRate: sr, data: silence })
    expect(Array.from(t1.f0).every((v) => v === 0)).toBe(true)
    const rng = makeRng(7)
    const noise = new Float32Array(sr).map(() => 0.3 * (rng() * 2 - 1))
    const t2 = analyzePitch({ sampleRate: sr, data: noise })
    const voiced = Array.from(t2.f0).filter((v) => v > 0).length
    expect(voiced / t2.f0.length).toBeLessThan(0.1)
  })

  it('handles empty, tiny and non-finite input', () => {
    expect(analyzePitch({ sampleRate: 48000, data: new Float32Array(0) }).f0.length).toBe(0)
    const tiny = analyzePitch({ sampleRate: 48000, data: new Float32Array(100) })
    expect(tiny.f0.length).toBeGreaterThan(0)
    const bad = new Float32Array(4800).fill(NaN)
    const t = analyzePitch({ sampleRate: 48000, data: bad })
    expect(Array.from(t.f0).every((v) => v === 0)).toBe(true)
  })

  it('reports progress', () => {
    const calls: number[] = []
    analyzePitch({ sampleRate: 48000, data: harmonicTone(48000, 1, 220) }, (f) => calls.push(f))
    expect(calls.length).toBeGreaterThan(2)
    expect(calls[calls.length - 1]).toBe(1)
  })
})
