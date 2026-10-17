// Mastering helpers: BS.1770-style integrated loudness (K-weighting + gating)
// and a zero-latency (offline look-ahead) true-peak-aware stereo limiter.

import { designBiquad } from './biquad'

/** Integrated loudness in LUFS of the given channels (-Infinity for silence). */
export function integratedLoudness(channels: Float32Array[], sr: number): number {
  if (channels.length === 0 || channels[0].length === 0) return -Infinity
  const n = channels[0].length
  // identical channels (dual mono): filter once, count twice
  const uniq: Float32Array[] = []
  const weight: number[] = []
  for (const ch of channels) {
    const k = uniq.indexOf(ch)
    if (k >= 0) weight[k]++
    else {
      uniq.push(ch)
      weight.push(1)
    }
  }
  const shelf = designBiquad('highshelf', 1681.974450955533, sr, 0.7071752369554196, 3.999843853973347)
  const hp = designBiquad('highpass', 38.13547087602444, sr, 0.5003270373238773)
  const step = Math.max(1, Math.round(0.1 * sr))
  const nSteps = Math.ceil(n / step)
  const stepPow = new Float64Array(nSteps)
  for (let c = 0; c < uniq.length; c++) kWeightedStepPower(uniq[c], weight[c], shelf, hp, step, stepPow)
  const blocks: number[] = []
  if (nSteps < 4) {
    let acc = 0
    for (let s = 0; s < nSteps; s++) acc += stepPow[s]
    blocks.push(acc / n)
  } else {
    for (let s = 0; s + 4 <= nSteps; s++) {
      const len = Math.min(n, (s + 4) * step) - s * step
      blocks.push((stepPow[s] + stepPow[s + 1] + stepPow[s + 2] + stepPow[s + 3]) / len)
    }
  }
  const lufs = (z: number): number => -0.691 + 10 * Math.log10(z + 1e-30)
  const abs = blocks.filter((z) => lufs(z) > -70)
  if (abs.length === 0) return -Infinity
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length
  const relGate = lufs(meanAbs) - 10
  const rel = abs.filter((z) => lufs(z) > relGate)
  if (rel.length === 0) return -Infinity
  return lufs(rel.reduce((a, b) => a + b, 0) / rel.length)
}

/** K-weight (two biquads, fused) and accumulate weighted power per `step` samples. */
function kWeightedStepPower(
  x: Float32Array,
  wgt: number,
  f1: { b0: number; b1: number; b2: number; a1: number; a2: number },
  f2: { b0: number; b1: number; b2: number; a1: number; a2: number },
  step: number,
  stepPow: Float64Array,
): void {
  const n = x.length
  const { b0, b1, b2, a1, a2 } = f1
  const c0 = f2.b0
  const c1 = f2.b1
  const c2 = f2.b2
  const d1 = f2.a1
  const d2 = f2.a2
  let z1 = 0
  let z2 = 0
  let q1 = 0
  let q2 = 0
  let acc = 0
  let s = 0
  let cnt = 0
  for (let i = 0; i < n; i++) {
    const v = x[i]
    const y = b0 * v + z1
    z1 = b1 * v - a1 * y + z2
    z2 = b2 * v - a2 * y
    const u = c0 * y + q1
    q1 = c1 * y - d1 * u + q2
    q2 = c2 * y - d2 * u
    acc += u * u
    if (++cnt === step) {
      stepPow[s++] += wgt * acc
      acc = 0
      cnt = 0
    }
  }
  if (cnt > 0) stepPow[s] += wgt * acc
}

// 4x polyphase windowed-sinc interpolator taps (8 taps per phase) for true-peak estimation
const TP_PHASES: Float64Array[] = (() => {
  const out: Float64Array[] = []
  for (let p = 1; p < 4; p++) {
    const frac = p / 4
    const taps = new Float64Array(8)
    let sum = 0
    for (let j = -3; j <= 4; j++) {
      const t = j - frac
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)
      const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / 4.5)
      taps[j + 3] = sinc * w
      sum += taps[j + 3]
    }
    for (let j = 0; j < 8; j++) taps[j] /= sum
    out.push(taps)
  }
  return out
})()

/** |x| at sample i, or the largest 4x-oversampled inter-sample peak between i and i+1 when either is above `checkAbove`. */
function tpAt(x: Float32Array, i: number, checkAbove: number): number {
  const n = x.length
  const a = Math.abs(x[i])
  const b = i + 1 < n ? Math.abs(x[i + 1]) : 0
  let pk = a
  if (a > checkAbove || b > checkAbove) {
    for (const taps of TP_PHASES) {
      let s = 0
      for (let j = -3; j <= 4; j++) {
        const idx = i + j
        if (idx >= 0 && idx < n) s += taps[j + 3] * x[idx]
      }
      const v = Math.abs(s)
      if (v > pk) pk = v
    }
  }
  return pk
}

/** True peak (linear, 4x oversampled) over all channels. */
export function truePeak(chs: Float32Array[]): number {
  let m = 0
  for (const x of chs) for (let i = 0; i < x.length; i++) {
    const v = tpAt(x, i, 0)
    if (v > m) m = v
  }
  return m
}

export interface LimiterParams {
  ceilingDb: number
  lookaheadMs?: number
  releaseMs?: number
}

/**
 * Stereo-linked look-ahead limiter (in place, streaming: O(look-ahead) memory).
 * Gain at n = box-average over L of the release-smoothed minimum of the required gain
 * over [n, n+L-1], so every (true) peak is reached before it arrives. Guarantees |sample| ≤ ceiling.
 */
export function limitStereo(left: Float32Array, right: Float32Array, sr: number, p: LimiterParams): number {
  const n = left.length
  if (n === 0) return 0
  const ceil = Math.pow(10, p.ceilingDb / 20)
  const target = ceil * 0.995
  const check = target * 0.7
  const L = Math.max(5, Math.round(((p.lookaheadMs ?? 2) / 1000) * sr))
  const aRel = Math.exp(-1 / (((p.releaseMs ?? 80) / 1000) * sr))
  const R = L + 1
  const reqRing = new Float64Array(R)
  const dq = new Int32Array(R)
  let h = 0 // deque head/tail as running counters (mod R)
  let t = 0
  const box = new Float64Array(L).fill(1)
  let sum = L
  let st = 1
  let minG = 1
  for (let k = 0; k < n + L - 1; k++) {
    let r = 1
    if (k < n) {
      const e = Math.max(tpAt(left, k, check), tpAt(right, k, check))
      if (e > target) r = target / e
    }
    reqRing[k % R] = r
    while (t > h && reqRing[dq[(t - 1) % R] % R] >= r) t--
    dq[t % R] = k
    t++
    const ni = k - (L - 1)
    if (ni < 0) continue
    while (dq[h % R] < ni) h++
    const m = reqRing[dq[h % R] % R]
    st = m < st ? m : m + (st - m) * aRel
    const bi = ni % L
    sum += st - box[bi]
    box[bi] = st
    const g = sum / L
    if (g < 1) {
      left[ni] *= g
      right[ni] *= g
      if (g < minG) minG = g
    }
  }
  // final safety: hard ceiling + NaN scrub
  for (let i = 0; i < n; i++) {
    let a = left[i]
    let b = right[i]
    if (!(a === a)) a = 0
    if (!(b === b)) b = 0
    left[i] = a > ceil ? ceil : a < -ceil ? -ceil : a
    right[i] = b > ceil ? ceil : b < -ceil ? -ceil : b
  }
  return -20 * Math.log10(minG)
}
