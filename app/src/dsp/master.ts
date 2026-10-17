// Mastering helpers: BS.1770-style integrated loudness (K-weighting + gating)
// and a zero-latency (offline look-ahead) true-peak-aware stereo limiter.

import { biquad, designBiquad } from './biquad'

/** Integrated loudness in LUFS of the given channels (-Infinity for silence). */
export function integratedLoudness(channels: Float32Array[], sr: number): number {
  if (channels.length === 0 || channels[0].length === 0) return -Infinity
  const n = channels[0].length
  const shelf = designBiquad('highshelf', 1681.974450955533, sr, 0.7071752369554196, 3.999843853973347)
  const hp = designBiquad('highpass', 38.13547087602444, sr, 0.5003270373238773)
  const step = Math.max(1, Math.round(0.1 * sr))
  const nSteps = Math.ceil(n / step)
  const stepPow = new Float64Array(nSteps)
  for (const ch of channels) {
    const k = new Float32Array(ch)
    biquad(k, shelf)
    biquad(k, hp)
    for (let s = 0; s < nSteps; s++) {
      let acc = 0
      const e = Math.min(n, (s + 1) * step)
      for (let i = s * step; i < e; i++) acc += k[i] * k[i]
      stepPow[s] += acc
    }
  }
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

/** Peak envelope including inter-sample (4x oversampled) peaks; max over channels. */
export function truePeakEnvelope(chs: Float32Array[], checkAbove: number): Float32Array {
  const n = chs[0].length
  const env = new Float32Array(n)
  for (const x of chs) {
    for (let i = 0; i < n; i++) {
      const a = Math.abs(x[i])
      let pk = a
      const b = i + 1 < n ? Math.abs(x[i + 1]) : 0
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
      if (pk > env[i]) env[i] = pk
    }
  }
  return env
}

export function truePeak(chs: Float32Array[]): number {
  const env = truePeakEnvelope(chs, 0)
  let m = 0
  for (let i = 0; i < env.length; i++) if (env[i] > m) m = env[i]
  return m
}

export interface LimiterParams {
  ceilingDb: number
  lookaheadMs?: number
  releaseMs?: number
}

/** Stereo-linked look-ahead limiter (in place). Guarantees |sample| ≤ ceiling. */
export function limitStereo(left: Float32Array, right: Float32Array, sr: number, p: LimiterParams): number {
  const n = left.length
  if (n === 0) return 0
  const ceil = Math.pow(10, p.ceilingDb / 20)
  const target = ceil * 0.995
  const env = truePeakEnvelope([left, right], target * 0.5)
  const L = Math.max(1, Math.round(((p.lookaheadMs ?? 2) / 1000) * sr))
  // per-sample required gain
  const req = new Float32Array(n)
  let anyOver = false
  for (let i = 0; i < n; i++) {
    const e = env[i]
    if (e > target) {
      req[i] = target / e
      anyOver = true
    } else req[i] = 1
  }
  let maxGr = 0
  if (anyOver) {
    // min over [i, i+L-1] (look-ahead)
    const mins = new Float32Array(n)
    const dq = new Int32Array(n + 1)
    let h = 0
    let t = 0
    let next = 0
    for (let i = 0; i < n; i++) {
      const hi = Math.min(n - 1, i + L - 1)
      while (next <= hi) {
        while (t > h && req[dq[t - 1]] >= req[next]) t--
        dq[t++] = next++
      }
      while (dq[h] < i) h++
      mins[i] = req[dq[h]]
    }
    // instant attack, exponential release
    const aRel = Math.exp(-1 / (((p.releaseMs ?? 80) / 1000) * sr))
    let st = 1
    for (let i = 0; i < n; i++) {
      const v = mins[i]
      st = v < st ? v : v + (st - v) * aRel
      mins[i] = st
    }
    // box filter of length L (gain reaches the target before each peak)
    let acc = 0
    const g = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      acc += mins[i]
      if (i >= L) acc -= mins[i - L]
      const cnt = Math.min(L, i + 1)
      // pad history with 1.0 at the start
      g[i] = (acc + (L - cnt)) / L
    }
    let minG = 1
    for (let i = 0; i < n; i++) {
      const gi = g[i]
      left[i] *= gi
      right[i] *= gi
      if (gi < minG) minG = gi
    }
    maxGr = -20 * Math.log10(minG)
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
  return maxGr
}
