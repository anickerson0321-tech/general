import { expect, it } from 'vitest'
import { analyzePitch, polishVocal } from '../index'
import { synthVoice } from './synthVoice'
import type { SynthNote } from './synthVoice'
import { makeRng } from '../util'

it('3 minutes @ 48 kHz: analyzePitch + polishVocal(75) in reasonable time', () => {
  const sr = 48000
  const dur = 180
  const rng = makeRng(42)
  const scale = [57, 59, 60, 62, 64, 65, 67, 69, 71, 72]
  const notes: SynthNote[] = []
  let t = 0.3
  while (t < dur - 1) {
    const len = 0.25 + rng() * 0.9
    notes.push({ start: t, end: t + len, midi: scale[Math.floor(rng() * scale.length)] + (rng() - 0.5) * 0.8, scoop: rng() < 0.3 ? 1 : 0 })
    t += len + (rng() < 0.25 ? 0.4 + rng() * 0.6 : 0.06)
  }
  const data = synthVoice({ sr, duration: dur, notes, vibratoCents: 30, consonants: true, noiseFloor: 0.003 })
  const t0 = performance.now()
  const analysis = analyzePitch({ sampleRate: sr, data })
  const t1 = performance.now()
  const out = polishVocal({ sampleRate: sr, data }, { amount: 75, key: { tonic: 9, mode: 'minor' }, analysis })
  const t2 = performance.now()
  console.log(
    `[perf] 180 s @ 48 kHz: analyzePitch ${(t1 - t0).toFixed(0)} ms, polishVocal(75) ${(t2 - t1).toFixed(0)} ms, total ${((t2 - t0) / 1000).toFixed(2)} s`,
  )
  expect(out.left.length).toBe(data.length)
  expect(t1 - t0).toBeLessThan(3000)
  expect(t2 - t0).toBeLessThan(12000)
}, 60000)
