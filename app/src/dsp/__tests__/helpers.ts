import { analyzePitch } from '../pitch'

/** Median of a numeric array (NaN when empty). */
export function med(a: number[]): number {
  if (a.length === 0) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[s.length >> 1]
}

/**
 * Analyse `y` and return per-frame cent deviations from `ref(t)` (Hz, NaN = skip),
 * restricted to [t0, t1) when given.
 */
export function centsVs(y: Float32Array, sr: number, ref: (t: number) => number, t0 = 0, t1 = Infinity): number[] {
  const tr = analyzePitch({ sampleRate: sr, data: y })
  const e: number[] = []
  for (let f = 0; f < tr.f0.length; f++) {
    const t = f * tr.hopSec
    if (t < t0 || t >= t1) continue
    const g = ref(t)
    if (tr.f0[f] > 0 && g === g) e.push(1200 * Math.log2(tr.f0[f] / g))
  }
  return e
}

export function mono(l: Float32Array, r: Float32Array): Float32Array {
  const m = new Float32Array(l.length)
  for (let i = 0; i < m.length; i++) m[i] = 0.5 * (l[i] + r[i])
  return m
}

export function stats(buf: Float32Array): { peak: number; bad: number } {
  let peak = 0
  let bad = 0
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]
    if (!Number.isFinite(v)) bad++
    else if (Math.abs(v) > peak) peak = Math.abs(v)
  }
  return { peak, bad }
}

export const A4_HZ = 440
export const centsToRatio = (c: number): number => Math.pow(2, c / 1200)
