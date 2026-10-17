// TD-PSOLA pitch shifting driven by a pitch track.
// - pitch marks (epochs) placed on the dominant per-period peak of a
//   segment-adaptive low-passed copy, tracked period-to-period with a
//   deviation penalty (consistent marks, no half-period jumps)
// - asymmetric Hann grains between neighbouring marks, fractional placement,
//   window-sum normalisation (flat envelope for any ratio)
// - unvoiced audio passes through untouched; short crossfades at segment edges

import { butterworth, filtfilt } from './biquad'
import { cubicAt } from './util'

export interface MarkSegment {
  /** sample range covered by the voiced segment */
  start: number
  end: number
  /** fractional pitch-mark positions (samples), increasing */
  marks: Float64Array
}

export interface Marks {
  sr: number
  segments: MarkSegment[]
}

function f0AtSample(f0: Float32Array, hopSec: number, sr: number, n: number): number {
  const fpos = n / sr / hopSec
  const i = Math.floor(fpos)
  const t = fpos - i
  const a = i >= 0 && i < f0.length ? f0[i] : 0
  const b = i + 1 >= 0 && i + 1 < f0.length ? f0[i + 1] : 0
  if (a > 0 && b > 0) return a * Math.pow(b / a, t)
  return a > 0 ? a : b
}

/** Detect pitch marks for every voiced run of `f0` (Hz per frame, 0 = unvoiced). */
export function detectMarks(x: Float32Array, sr: number, f0: Float32Array, hopSec: number): Marks {
  const segments: MarkSegment[] = []
  const nF = f0.length
  // one scratch buffer (sized for the longest voiced run) reused by every segment
  let maxLen = 0
  for (let a = 0; a < nF; ) {
    if (!(f0[a] > 0)) {
      a++
      continue
    }
    let b = a
    let fmin = Infinity
    while (b < nF && f0[b] > 0) fmin = Math.min(fmin, f0[b++])
    const margin = 2 * Math.ceil(sr / Math.max(40, fmin))
    maxLen = Math.max(maxLen, Math.round((b - a + 1) * hopSec * sr) + 2 * margin + 4)
    a = b
  }
  const scratch = new Float32Array(Math.min(x.length, maxLen))
  let i = 0
  while (i < nF) {
    if (!(f0[i] > 0)) {
      i++
      continue
    }
    let j = i
    while (j < nF && f0[j] > 0) j++
    const start = Math.max(0, Math.round((i - 0.5) * hopSec * sr))
    const end = Math.min(x.length - 1, Math.round((j - 0.5) * hopSec * sr))
    if (end - start > 8) {
      const seg = marksForSegment(x, sr, f0, hopSec, start, end, i, j, scratch)
      if (seg) segments.push(seg)
    }
    i = j
  }
  return { sr, segments }
}

function marksForSegment(
  x: Float32Array,
  sr: number,
  f0: Float32Array,
  hopSec: number,
  start: number,
  end: number,
  fa: number,
  fb: number,
  scratch: Float32Array,
): MarkSegment | null {
  // median f0 → low-pass cutoff that keeps the fundamental dominant
  const fs: number[] = []
  for (let k = fa; k < fb; k++) fs.push(f0[k])
  fs.sort((p, q) => p - q)
  const fmed = fs[fs.length >> 1]
  const maxP = sr / Math.max(40, fs[0])
  const margin = Math.ceil(maxP * 2)
  const lo = Math.max(0, start - margin)
  const hi = Math.min(x.length, end + margin)
  const s = hi - lo <= scratch.length ? scratch.subarray(0, hi - lo) : new Float32Array(hi - lo)
  s.set(x.subarray(lo, hi))
  filtfilt(s, butterworth('lowpass', Math.min(Math.max(1.6 * fmed, 250), 0.45 * sr), sr, 2))
  let mx = 0
  let mn = 0
  for (let k = start - lo; k < end - lo; k++) {
    const v = s[k]
    if (v > mx) mx = v
    if (v < mn) mn = v
  }
  const sign = mx >= -mn ? 1 : -1
  const amp = Math.max(mx, -mn)
  if (amp < 1e-9) return null
  const at = (n: number): number => {
    const k = n - lo
    return k >= 0 && k < s.length ? sign * s[k] : -Infinity
  }
  const marks: number[] = []
  // first mark: strongest peak inside the first period
  const P0 = sr / Math.max(40, f0AtSample(f0, hopSec, sr, start) || fmed)
  let best = start
  let bestV = -Infinity
  for (let n = start; n < Math.min(end, start + Math.ceil(P0)); n++) {
    const v = at(n)
    if (v > bestV) {
      bestV = v
      best = n
    }
  }
  marks.push(refinePeak(at, best))
  for (;;) {
    const m = marks[marks.length - 1]
    const fHere = f0AtSample(f0, hopSec, sr, m) || fmed
    const P = sr / Math.max(40, fHere)
    const e = m + P
    if (e > end + 0.5 * P) break
    const w = 0.25 * P
    const k0 = Math.ceil(e - w)
    const k1 = Math.floor(e + w)
    // local amplitude for the deviation penalty
    let la = 0
    for (let n = k0; n <= k1; n++) {
      const v = Math.abs(at(n))
      if (v !== Infinity && v > la) la = v
    }
    let bn = Math.round(e)
    let bs = -Infinity
    for (let n = k0; n <= k1; n++) {
      const dv = (n - e) / w
      const sc = at(n) - 0.5 * la * dv * dv
      if (sc > bs) {
        bs = sc
        bn = n
      }
    }
    let next = la > 1e-9 ? refinePeak(at, bn) : e
    if (next - m < 0.6 * P || next - m > 1.4 * P) next = e
    marks.push(next)
  }
  if (marks.length < 3) return null
  return { start, end, marks: Float64Array.from(marks) }
}

function refinePeak(at: (n: number) => number, n: number): number {
  const a = at(n - 1)
  const b = at(n)
  const c = at(n + 1)
  if (!isFinite(a) || !isFinite(c)) return n
  const den = a - 2 * b + c
  if (den >= 0) return n
  const d = (0.5 * (a - c)) / den
  return n + Math.max(-0.5, Math.min(0.5, d))
}

export interface PsolaOptions {
  /** semitone shift per frame (same frame grid as the f0 track) */
  shift: Float32Array
  hopSec: number
  formantPreserve?: boolean
  /** crossfade at voiced/unvoiced edges (s) */
  fadeSec?: number
  /** extra constant shift in semitones added everywhere (used for doubles) */
  offset?: number
}

/** Pitch-shift `x` with TD-PSOLA. Returns a new buffer, sample aligned with `x`. */
export function psolaShift(x: Float32Array, marks: Marks, opt: PsolaOptions, into?: Float32Array): Float32Array {
  const sr = marks.sr
  // `into` === x → in place (segment writes are deferred by one segment so that no later
  // grain reads already-shifted audio); another buffer → filled with the result.
  const inPlace = into === x
  const out = into ?? new Float32Array(x)
  if (!inPlace && into) out.set(x)
  let pending: { a: number; b: number; lo: number; vals: Float32Array } | null = null
  const pool = [new Float32Array(0), new Float32Array(0)]
  let wsPool = new Float32Array(0)
  let slot = 0
  const flush = (): void => {
    if (!pending) return
    const { a, b, lo, vals } = pending
    for (let n = a; n <= b; n++) out[n] = vals[n - lo]
    pending = null
  }
  const shift = opt.shift
  const hopSec = opt.hopSec
  const preserve = opt.formantPreserve !== false
  const offset = opt.offset ?? 0
  const fadeN = Math.max(8, Math.round((opt.fadeSec ?? 0.006) * sr))
  const xl = x.length
  const shiftAt = (n: number): number => {
    const fpos = n / sr / hopSec
    const i = Math.floor(fpos)
    const t = fpos - i
    const a = i >= 0 && i < shift.length ? shift[i] : 0
    const b = i + 1 >= 0 && i + 1 < shift.length ? shift[i + 1] : a
    return offset + a + (b - a) * t
  }
  for (const seg of marks.segments) {
    const mk = seg.marks
    const M = mk.length
    // skip segments that need no change
    let maxAbs = 0
    const f0s = Math.floor(seg.start / sr / hopSec)
    const f1s = Math.ceil(seg.end / sr / hopSec)
    for (let f = Math.max(0, f0s); f <= Math.min(shift.length - 1, f1s); f++) maxAbs = Math.max(maxAbs, Math.abs(shift[f] + offset))
    if (maxAbs < 0.003) continue
    let maxPer = 0
    for (let k = 1; k < M; k++) maxPer = Math.max(maxPer, mk[k] - mk[k - 1])
    const lo = Math.max(0, Math.floor(mk[0] - 3 * maxPer))
    const hi = Math.min(x.length, Math.ceil(mk[M - 1] + 3 * maxPer) + 1)
    // reuse accumulators across segments (ping-pong so the deferred in-place write stays valid)
    const need = hi - lo
    if (pool[slot].length < need) pool[slot] = new Float32Array(Math.max(need, (pool[slot].length * 3) >> 1))
    const acc = pool[slot].subarray(0, need)
    acc.fill(0)
    if (wsPool.length < need) wsPool = new Float32Array(Math.max(need, (wsPool.length * 3) >> 1))
    const wsum = wsPool.subarray(0, need)
    wsum.fill(0)
    slot ^= 1
    let t = mk[0]
    let k = 0 // nearest analysis mark
    let j = 0 // interval containing t
    const tEnd = mk[M - 1]
    while (t <= tEnd) {
      while (k + 1 < M && Math.abs(mk[k + 1] - t) <= Math.abs(mk[k] - t)) k++
      const beta = Math.pow(2, shiftAt(t) / 12)
      const L = k > 0 ? mk[k] - mk[k - 1] : mk[1] - mk[0]
      const R = k < M - 1 ? mk[k + 1] - mk[k] : mk[k] - mk[k - 1]
      const scale = preserve ? 1 : beta // >1 squeezes the grain → formants follow pitch
      const left = L / scale
      const right = R / scale
      const n0 = Math.max(lo, Math.ceil(t - left))
      const n1 = Math.min(hi - 1, Math.floor(t + right))
      const ck = mk[k]
      // left half then right half; Hann values via the Chebyshev cosine recurrence
      for (let half = 0; half < 2; half++) {
        const span = half === 0 ? L : R
        const a = half === 0 ? n0 : Math.max(n0, Math.ceil(t))
        const b = half === 0 ? Math.min(n1, Math.ceil(t) - 1) : n1
        if (b < a) continue
        const th = (Math.PI * scale) / span // phase step per output sample
        let u0 = (a - t) * scale
        const cs = Math.cos(th)
        let cPrev = Math.cos((Math.PI * (u0 - scale)) / span)
        let cCur = Math.cos((Math.PI * u0) / span)
        let pos = ck + u0
        for (let nn = a; nn <= b; nn++) {
          const w = 0.5 + 0.5 * cCur
          if (w > 0) {
            const ii = Math.floor(pos)
            const f = pos - ii
            let v: number
            if (ii >= 1 && ii + 2 < xl) {
              const xm1 = x[ii - 1]
              const x0 = x[ii]
              const x1 = x[ii + 1]
              const x2 = x[ii + 2]
              const c1 = 0.5 * (x1 - xm1)
              const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
              const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
              v = ((c3 * f + c2) * f + c1) * f + x0
            } else v = cubicAt(x, pos)
            acc[nn - lo] += w * v
            wsum[nn - lo] += w
          }
          const cNext = 2 * cs * cCur - cPrev
          cPrev = cCur
          cCur = cNext
          pos += scale
          u0 += scale
        }
      }
      while (j + 2 < M && mk[j + 1] <= t) j++
      const P = mk[j + 1] - mk[j]
      t += P / beta
    }
    // normalise + crossfade with the original at the segment edges
    const a = Math.ceil(mk[0])
    const b = Math.floor(tEnd)
    const fl = Math.max(1, Math.min(fadeN, Math.floor((b - a) / 3)))
    const na = Math.max(a, lo)
    const nb = Math.min(b, hi - 1)
    for (let n = na; n <= nb; n++) {
      const ws = wsum[n - lo]
      let res = x[n]
      if (ws >= 1e-4) {
        const v = acc[n - lo] / Math.max(ws, 0.15)
        let mix = 1
        if (n - a < fl) mix = (n - a) / fl
        if (b - n < fl) mix = Math.min(mix, (b - n) / fl)
        mix = mix * mix * (3 - 2 * mix)
        res = x[n] + mix * (v - x[n])
      }
      acc[n - lo] = res
    }
    if (inPlace) {
      flush()
      pending = { a: na, b: nb, lo, vals: acc }
    } else for (let n = na; n <= nb; n++) out[n] = acc[n - lo]
  }
  flush()
  return out
}
