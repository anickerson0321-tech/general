// Dynamics: vocal-aware expander/gate, feed-forward compressor, split-band
// de-esser and tape-style saturation. Gain computers run at a control rate and
// gains are linearly interpolated per sample (fast, click-free).

import { biquad, designBiquad } from './biquad'
import { clamp, slidingMax } from './util'

// ---------------------------------------------------------------- gate / expander

export interface GateParams {
  /** max attenuation for background noise (dB, positive) */
  noiseRangeDb: number
  /** max attenuation for breaths far from sung words (dB, positive) */
  breathRangeDb: number
  /** estimated noise floor (dBFS RMS) */
  noiseFloorDb: number
  /** typical sung level (dBFS RMS) */
  voiceDb: number
  /** per-frame voiced flags of the pitch track (frames of hopSec) */
  voiced?: Uint8Array
  hopSec?: number
  attackMs?: number
  holdMs?: number
  releaseMs?: number
  lookaheadMs?: number
}

/** Vocal-aware downward expander (in place). Words never get chopped: gates
 *  only open faster than they close, hold, look ahead, and keep the region
 *  around voiced notes (consonants!) open. */
export function vocalGate(x: Float32Array, sr: number, p: GateParams): void {
  if (p.noiseRangeDb <= 0.01 && p.breathRangeDb <= 0.01) return
  const n = x.length
  const B = Math.max(1, Math.round(sr * 0.001)) // 1 ms control blocks
  const nb = Math.ceil(n / B)
  const ms = new Float32Array(nb)
  for (let b = 0; b < nb; b++) {
    let s = 0
    const e = Math.min(n, (b + 1) * B)
    for (let i = b * B; i < e; i++) s += x[i] * x[i]
    ms[b] = s / Math.max(1, e - b * B)
  }
  // 6 ms centred RMS
  const lev = new Float32Array(nb)
  for (let b = 0; b < nb; b++) {
    let s = 0
    let c = 0
    for (let k = Math.max(0, b - 3); k <= Math.min(nb - 1, b + 3); k++) {
      s += ms[k]
      c++
    }
    lev[b] = 10 * Math.log10(s / c + 1e-20)
  }
  // closeness to voiced notes: open 120 ms before a note and 150 ms after it
  const near = new Float32Array(nb)
  if (p.voiced && p.hopSec) {
    const v = new Float32Array(nb)
    for (let b = 0; b < nb; b++) {
      const f = Math.floor((b * B) / sr / p.hopSec)
      v[b] = f < p.voiced.length && p.voiced[f] ? 1 : 0
    }
    const dil = slidingMax(v, 150, 120)
    // soften edges (20 ms)
    let acc = 0
    const w = 20
    for (let b = 0; b < nb + w; b++) {
      if (b < nb) acc += dil[b]
      if (b - 2 * w >= 0) acc -= dil[b - 2 * w]
      const c = b - w
      if (c >= 0 && c < nb) near[c] = acc / (2 * w)
    }
  }
  const N = p.noiseFloorDb
  const V = p.voiceDb
  const thrNoise = Math.min(Math.max(N + 6, V - 40), V - 18)
  const thrBreath = Math.max(thrNoise + 3, V - 17)
  const knee = 6
  const target = new Float32Array(nb)
  const expand = (L: number, thr: number, slope: number, range: number): number => {
    const over = L - thr
    let g: number
    if (over >= knee / 2) g = 0
    else if (over > -knee / 2) {
      const t = over - knee / 2
      g = (slope * t * t) / (2 * knee)
      g = -g
    } else g = slope * over
    return Math.max(-range, Math.min(0, g))
  }
  for (let b = 0; b < nb; b++) {
    const L = lev[b]
    const gN = expand(L, thrNoise, 2, p.noiseRangeDb)
    const gB = expand(L, thrBreath, 1, p.breathRangeDb)
    target[b] = Math.max(-p.noiseRangeDb, gN + (1 - near[b]) * gB)
  }
  // look-ahead (open early) + hold (close late), then attack/release ballistics
  const la = Math.round(p.lookaheadMs ?? 6)
  const hold = Math.round(p.holdMs ?? 70)
  const held = slidingMax(target, hold, la)
  const aAtt = Math.exp(-1 / Math.max(0.1, p.attackMs ?? 2))
  const aRel = Math.exp(-1 / Math.max(1, p.releaseMs ?? 160))
  const gains = new Float32Array(nb + 1)
  let st = held[0]
  for (let b = 0; b < nb; b++) {
    const t = held[b]
    st = t > st ? t + (st - t) * aAtt : t + (st - t) * aRel
    gains[b] = Math.pow(10, st / 20)
  }
  gains[nb] = gains[nb - 1]
  for (let b = 0; b < nb; b++) {
    const g0 = b === 0 ? gains[0] : 0.5 * (gains[b - 1] + gains[b])
    const g1 = 0.5 * (gains[b] + gains[b + 1])
    const s0 = b * B
    const e = Math.min(n, s0 + B)
    for (let i = s0; i < e; i++) x[i] *= g0 + ((g1 - g0) * (i - s0)) / B
  }
}

// ---------------------------------------------------------------- compressor

export interface CompParams {
  thresholdDb: number
  ratio: number
  kneeDb?: number
  attackMs: number
  releaseMs: number
  /** RMS window (ms); 0 = peak detection */
  rmsMs?: number
  makeupDb?: number
}

export function staticGainDb(L: number, T: number, R: number, knee: number): number {
  const over = L - T
  const s = 1 / R - 1
  if (2 * over <= -knee) return 0
  if (knee > 0 && 2 * Math.abs(over) < knee) {
    const t = over + knee / 2
    return (s * t * t) / (2 * knee)
  }
  return s * over
}

/** Feed-forward log-domain compressor. Writes into `out` (default: in place). */
export function compress(x: Float32Array, sr: number, p: CompParams, out: Float32Array = x): Float32Array {
  const n = x.length
  if (p.ratio <= 1.0001 && !p.makeupDb) {
    if (out !== x) out.set(x)
    return out
  }
  const B = 16
  const knee = p.kneeDb ?? 6
  const rms = (p.rmsMs ?? 0) > 0
  const aR = rms ? 1 - Math.exp(-1 / ((p.rmsMs as number) * 0.001 * sr)) : 0
  const aAtt = Math.exp(-B / (Math.max(0.05, p.attackMs) * 0.001 * sr))
  const aRel = Math.exp(-B / (Math.max(1, p.releaseMs) * 0.001 * sr))
  const makeup = p.makeupDb ?? 0
  let env = 0
  let st = 0
  let gPrev = Math.pow(10, makeup / 20)
  for (let s0 = 0; s0 < n; s0 += B) {
    const e = Math.min(n, s0 + B)
    let pk = 0
    for (let i = s0; i < e; i++) {
      const v = x[i] * x[i]
      if (rms) env += aR * (v - env)
      else if (v > pk) pk = v
    }
    const L = 10 * Math.log10((rms ? env : pk) + 1e-20)
    const gr = staticGainDb(L, p.thresholdDb, p.ratio, knee)
    st = gr < st ? gr + (st - gr) * aAtt : gr + (st - gr) * aRel
    const g = Math.pow(10, (st + makeup) / 20)
    const len = e - s0
    for (let i = s0; i < e; i++) out[i] = x[i] * (gPrev + ((g - gPrev) * (i - s0 + 1)) / len)
    gPrev = g
  }
  return out
}

// ---------------------------------------------------------------- de-esser

export interface DeEssParams {
  freq: number
  q?: number
  maxReductionDb: number
  /** absolute threshold for the sibilance band (dBFS RMS) */
  thresholdDb: number
  /** band must also exceed full-band level + relDb (dB) */
  relDb?: number
}

/** Split-band de-esser: only the sibilance band is turned down (in place). */
export function deEss(x: Float32Array, sr: number, p: DeEssParams): void {
  if (p.maxReductionDb <= 0.01) return
  const n = x.length
  const band = new Float32Array(x)
  biquad(band, designBiquad('bandpass', Math.min(p.freq, sr * 0.42), sr, p.q ?? 0.8))
  const aE = 1 - Math.exp(-1 / (0.004 * sr))
  const B = 16
  const aAtt = Math.exp(-B / (0.0008 * sr))
  const aRel = Math.exp(-B / (0.05 * sr))
  const rel = p.relDb ?? -9
  let eb = 0
  let ef = 0
  let st = 0
  let gPrev = 1
  for (let s0 = 0; s0 < n; s0 += B) {
    const e = Math.min(n, s0 + B)
    for (let i = s0; i < e; i++) {
      eb += aE * (band[i] * band[i] - eb)
      ef += aE * (x[i] * x[i] - ef)
    }
    const bDb = 10 * Math.log10(eb + 1e-20)
    const fDb = 10 * Math.log10(ef + 1e-20)
    const over = bDb - Math.max(p.thresholdDb, fDb + rel)
    const gr = -clamp(over * 0.8, 0, p.maxReductionDb)
    st = gr < st ? gr + (st - gr) * aAtt : gr + (st - gr) * aRel
    const g = Math.pow(10, st / 20)
    const len = e - s0
    for (let i = s0; i < e; i++) {
      const gi = gPrev + ((g - gPrev) * (i - s0 + 1)) / len
      x[i] += band[i] * (gi - 1)
    }
    gPrev = g
  }
}

// ---------------------------------------------------------------- saturation

function fastTanh(v: number): number {
  if (v > 3) return 1
  if (v < -3) return -1
  const v2 = v * v
  return (v * (27 + v2)) / (27 + 9 * v2)
}

/** Tape-style soft saturation with slight asymmetry (even harmonics). In place.
 *  `drive` 0..1; signal expected around -18 dBFS RMS. Unity small-signal gain. */
export function tapeSaturate(x: Float32Array, sr: number, drive: number): void {
  if (drive <= 0.001) return
  const k = 1 + 2.5 * drive
  const bias = 0.12 * drive
  const tb = fastTanh(bias)
  const slope = k * (1 - tb * tb)
  const mix = clamp(drive * 1.2, 0, 1)
  // gentle pre/de-emphasis: saturate the mids a little more than the extremes
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    const s = (fastTanh(k * v + bias) - tb) / slope
    x[i] = v + mix * (s - v)
  }
  // remove DC from asymmetry
  const R = Math.exp((-2 * Math.PI * 8) / sr)
  let xp = 0
  let yp = 0
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    const y = v - xp + R * yp
    xp = v
    yp = y
    x[i] = y
  }
}
