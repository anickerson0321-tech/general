// Opt-in peak-memory measurement (process-wide max RSS) for a 3-minute take.
//   DSP_MEM=1 npx vitest run src/dsp/__tests__/memory.test.ts --pool=forks --execArgv=--expose-gc
// Each test file runs in a fresh fork, so maxRSS reflects this file only.

import { expect, it } from 'vitest'
import { analyzePitch, polishVocal } from '../index'

interface ProcLike {
  env: Record<string, string | undefined>
  memoryUsage(): { rss: number; heapUsed: number; arrayBuffers: number }
  resourceUsage(): { maxRSS: number }
}
const proc = (globalThis as unknown as { process?: ProcLike }).process
const gc = (globalThis as unknown as { gc?: () => void }).gc

it.skipIf(!proc?.env.DSP_MEM)('peak memory: analyzePitch + polishVocal on 180 s @ 48 kHz', () => {
  const p = proc as ProcLike
  const sr = 48000
  const amount = Number(p.env.DSP_MEM_AMOUNT ?? 75)
  // cheap synthetic "sung" input: harmonic tone with gaps and vibrato
  const data = new Float32Array(sr * 180)
  let ph = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / sr
    const f = 220 * Math.pow(2, (Math.floor(t / 0.7) % 5) / 12 + 0.003 * Math.sin(2 * Math.PI * 5.5 * t))
    ph += f / sr
    ph -= Math.floor(ph)
    const on = t % 3.5 < 3 ? 1 : 0
    data[i] = on * 0.3 * (Math.sin(2 * Math.PI * ph) + 0.5 * Math.sin(4 * Math.PI * ph) + 0.25 * Math.sin(6 * Math.PI * ph))
  }
  gc?.()
  gc?.()
  const base = p.memoryUsage().rss
  const maxBefore = p.resourceUsage().maxRSS * 1024
  const t0 = performance.now()
  const analysis = analyzePitch({ sampleRate: sr, data })
  const out = polishVocal({ sampleRate: sr, data }, { amount, key: { tonic: 9, mode: 'minor' }, analysis })
  const ms = performance.now() - t0
  const peak = p.resourceUsage().maxRSS * 1024
  const outBytes = (out.left.byteLength + out.right.byteLength) / 1e6
  console.log(
    `[mem] amount ${amount}: baseline rss ${(base / 1e6).toFixed(0)} MB (prior max ${(maxBefore / 1e6).toFixed(0)}), ` +
      `peak ${(peak / 1e6).toFixed(0)} MB → +${((peak - base) / 1e6).toFixed(0)} MB above baseline ` +
      `(incl. ${outBytes.toFixed(0)} MB stereo output), ${ms.toFixed(0)} ms, gc=${gc ? 'yes' : 'no'}`,
  )
  expect(out.left.length).toBe(data.length)
  // phone Web Worker budget: hard ceiling 200 MB above baseline (incl. the 69 MB output)
  expect(peak - base).toBeLessThan(200e6)
}, 120000)
