// Monophonic pitch tracking: YIN difference function computed with FFTs on a
// decimated signal, pYIN-style threshold-distribution candidate probabilities,
// and a Viterbi pass over candidates + an unvoiced state for octave robustness.

import type { MonoBuffer, ProgressFn } from '../types'
import { fft } from './fft'
import { STREAM_BLOCK, butterworth, cascadeState, cascadeStream, designBiquad } from './biquad'
import { nextPow2, percentile } from './util'

export interface PitchTrack {
  sampleRate: number // of the analysed audio
  hopSec: number // time between frames (~0.005-0.01s)
  f0: Float32Array // Hz per frame, 0 = unvoiced
  confidence: Float32Array // 0..1 per frame
}

export interface AnalyzeOptions {
  /** lowest detectable f0 (Hz), default 60 */
  fmin?: number
  /** highest detectable f0 (Hz), default 1100 */
  fmax?: number
  /** frame hop, default 0.008 s */
  hopSec?: number
}

const K = 6 // candidates kept per frame
const BETA_B = 8 // threshold prior Beta(2, 8): mean 0.2
const UV_SCALE = 0.6
const SWITCH_COST = 3.0
const MAX_DPRIME = 0.65
/** favours deeper YIN dips (guards against octave-up errors when H2 dominates) */
const DEPTH_W = 6

function betaCdf2(x: number): number {
  // CDF of Beta(2, b): 1 - (1-x)^b (1 + b x)
  if (x <= 0) return 0
  if (x >= 1) return 1
  return 1 - Math.pow(1 - x, BETA_B) * (1 + BETA_B * x)
}

/** Monophonic pitch detection (YIN / pYIN-style, FFT-accelerated). */
export function analyzePitch(input: MonoBuffer, onProgress?: ProgressFn, opts: AnalyzeOptions = {}): PitchTrack {
  const sr = input.sampleRate
  const fmin = opts.fmin ?? 60
  const fmax = opts.fmax ?? 1100
  const D = Math.max(1, Math.round(sr / 16000))
  const sra = sr / D
  const hop = Math.max(1, Math.round((opts.hopSec ?? 0.008) * sra))
  const hopSec = hop / sra

  // ---- pre-processing: high-pass, anti-alias, decimate (block-streamed, no full-length temp)
  const src = input.data
  const pre = [designBiquad('highpass', 45, sr, Math.SQRT1_2)]
  if (D > 1) pre.push(...butterworth('lowpass', 0.36 * sra, sr, 8))
  const st = cascadeState(pre)
  const len = Math.floor(src.length / D)
  const y = new Float32Array(len)
  const blk = new Float32Array(STREAM_BLOCK * D)
  for (let b0 = 0; b0 < len * D; b0 += blk.length) {
    const m = Math.min(blk.length, len * D - b0)
    for (let i = 0; i < m; i++) {
      const v = src[b0 + i]
      blk[i] = v === v && v !== Infinity && v !== -Infinity ? v : 0
    }
    cascadeStream(blk, pre, st, m)
    for (let i = 0; i < m; i += D) y[(b0 + i) / D] = blk[i]
  }

  const nFrames = len === 0 ? 0 : Math.floor((len - 1) / hop) + 1
  const f0 = new Float32Array(nFrames)
  const confidence = new Float32Array(nFrames)
  if (nFrames === 0) return { sampleRate: sr, hopSec, f0, confidence }

  const W = Math.round(0.03 * sra)
  const tauMax = Math.min(Math.ceil(sra / fmin), Math.max(4, len))
  const tauMin = Math.max(2, Math.floor(sra / fmax))
  const N = nextPow2(W + tauMax + 2)
  const segLen = W + tauMax + 1
  const offset = (W >> 1) + (Math.round(sra / 250) >> 1)

  // per-frame local prefix sums of squares (double precision) — no full-length array
  const lp = new Float64Array(segLen + 2)
  const prefixFor = (s0: number): void => {
    lp[0] = 0
    for (let j = 0; j <= segLen; j++) {
      const idx = s0 + j
      const v = idx >= 0 && idx < len ? y[idx] : 0
      lp[j + 1] = lp[j] + v * v
    }
  }

  // frame energies → silence threshold
  const frameDb = new Float32Array(nFrames)
  for (let f = 0; f < nFrames; f++) {
    const s0 = f * hop - offset
    let e = 0
    for (let j = Math.max(0, s0); j < Math.min(len, s0 + W); j++) e += y[j] * y[j]
    frameDb[f] = 10 * Math.log10(e / W + 1e-20)
  }
  const loud = percentile(frameDb, 0.95)
  const silenceDb = Math.max(-75, loud - 55)

  const candTau = new Float32Array(nFrames * K)
  const candMass = new Float32Array(nFrames * K)
  const candDp = new Float32Array(nFrames * K)
  const candCount = new Uint8Array(nFrames)
  const pvArr = new Float32Array(nFrames)

  const reA = new Float64Array(N)
  const imA = new Float64Array(N)
  const reB = new Float64Array(N)
  const imB = new Float64Array(N)
  const reC = new Float64Array(N)
  const imC = new Float64Array(N)
  const d = new Float64Array(tauMax + 2)
  const dp = new Float64Array(tauMax + 2)
  const minTau: number[] = []
  const minVal: number[] = []
  const minMass: number[] = []

  const fillFrame = (f: number, re: Float64Array, im: Float64Array): void => {
    const s = f * hop - offset
    for (let j = 0; j < N; j++) {
      const idx = s + j
      const v = j < segLen && idx >= 0 && idx < len ? y[idx] : 0
      re[j] = v
      im[j] = j < W ? v : 0
    }
    fft(re, im)
  }

  // cross-spectrum A·conj(B) of the packed frame, written into (outRe, outIm) scaled by `sgn`
  const crossSpectrum = (re: Float64Array, im: Float64Array, into: 0 | 1): void => {
    for (let k = 0; k < N; k++) {
      const m = (N - k) & (N - 1)
      const zr = re[k]
      const zi = im[k]
      const mr = re[m]
      const mi = im[m]
      const Ar = 0.5 * (zr + mr)
      const Ai = 0.5 * (zi - mi)
      const Br = 0.5 * (zi + mi)
      const Bi = 0.5 * (mr - zr)
      const Cr = Ar * Br + Ai * Bi
      const Ci = Ai * Br - Ar * Bi
      if (into === 0) {
        reC[k] = Cr
        imC[k] = Ci
      } else {
        // add i * C
        reC[k] -= Ci
        imC[k] += Cr
      }
    }
  }

  const analyseFrame = (f: number, r: Float64Array): void => {
    prefixFor(f * hop - offset)
    const e0 = lp[W]
    d[0] = 0
    for (let tau = 1; tau <= tauMax; tau++) {
      const et = lp[tau + W] - lp[tau]
      const v = e0 + et - (2 * r[tau]) / N
      d[tau] = v > 0 ? v : 0
    }
    dp[0] = 1
    let run = 0
    for (let tau = 1; tau <= tauMax; tau++) {
      run += d[tau]
      dp[tau] = run > 0 ? (d[tau] * tau) / run : 1
    }
    minTau.length = 0
    minVal.length = 0
    for (let tau = tauMin; tau < tauMax; tau++) {
      const v = dp[tau]
      if (v < MAX_DPRIME && v < dp[tau - 1] && v <= dp[tau + 1]) {
        // parabolic refinement on the raw difference function
        const a = d[tau - 1]
        const b = d[tau]
        const c = d[tau + 1]
        const den = a - 2 * b + c
        let delta = den > 0 ? (0.5 * (a - c)) / den : 0
        if (delta > 0.5) delta = 0.5
        else if (delta < -0.5) delta = -0.5
        const pa = dp[tau - 1]
        const pc = dp[tau + 1]
        let val = v - 0.25 * (pa - pc) * delta
        if (val < 0) val = 0
        minTau.push(tau + delta)
        minVal.push(val)
      }
    }
    // pYIN: mass of thresholds for which this minimum is the first one below threshold
    minMass.length = minTau.length
    let prefMin = 1
    let pv = 0
    for (let j = 0; j < minTau.length; j++) {
      const v = minVal[j]
      if (v < prefMin) {
        const m = betaCdf2(prefMin) - betaCdf2(v)
        minMass[j] = m
        pv += m
        prefMin = v
      } else minMass[j] = 0
    }
    // keep the K most probable
    const order = minTau.map((_, j) => j).filter((j) => minMass[j] > 1e-6)
    order.sort((a, b) => minMass[b] - minMass[a])
    const cnt = Math.min(K, order.length)
    for (let c = 0; c < cnt; c++) {
      const j = order[c]
      candTau[f * K + c] = minTau[j]
      candMass[f * K + c] = minMass[j]
      candDp[f * K + c] = minVal[j]
    }
    candCount[f] = cnt
    pvArr[f] = Math.min(1, pv)
  }

  const progressEvery = Math.max(1, Math.floor(nFrames / 20))
  const pending: number[] = []
  const flush = (): void => {
    // pending holds up to 2 frames (already FFT'd into A/B buffers)
    if (pending.length === 0) return
    crossSpectrum(reA, imA, 0)
    if (pending.length === 2) crossSpectrum(reB, imB, 1)
    fft(reC, imC, true)
    analyseFrame(pending[0], reC)
    if (pending.length === 2) analyseFrame(pending[1], imC)
    pending.length = 0
  }
  for (let f = 0; f < nFrames; f++) {
    if (frameDb[f] < silenceDb) {
      candCount[f] = 0
      pvArr[f] = 0
      continue
    }
    if (pending.length === 0) {
      fillFrame(f, reA, imA)
      pending.push(f)
    } else {
      fillFrame(f, reB, imB)
      pending.push(f)
      flush()
    }
    if (onProgress && f % progressEvery === 0) onProgress((0.85 * f) / nFrames, 'Analysing pitch')
  }
  flush()

  // ---- Viterbi over (candidates + unvoiced)
  const S = K + 1
  const UV = K
  const back = new Int8Array(nFrames * S)
  let prev = new Float64Array(S)
  let cur = new Float64Array(S)
  const logT = new Float64Array(nFrames * K)
  for (let i = 0; i < nFrames * K; i++) logT[i] = candTau[i] > 0 ? 12 * Math.log2(candTau[i]) : 0
  const emis = (f: number, s: number): number => {
    if (s === UV) return -Math.log(Math.max((1 - pvArr[f]) * UV_SCALE, 1e-5))
    return -Math.log(Math.max(candMass[f * K + s], 1e-5)) + DEPTH_W * candDp[f * K + s]
  }
  for (let s = 0; s < S; s++) prev[s] = s === UV || s < candCount[0] ? emis(0, s) : Infinity
  for (let f = 1; f < nFrames; f++) {
    const cn = candCount[f]
    const pn = candCount[f - 1]
    for (let s = 0; s < S; s++) {
      cur[s] = Infinity
      if (s !== UV && s >= cn) continue
      let best = Infinity
      let arg = UV
      for (let q = 0; q < S; q++) {
        if (q !== UV && q >= pn) continue
        const pc = prev[q]
        if (pc === Infinity) continue
        let tc: number
        if (s === UV) tc = q === UV ? 0 : SWITCH_COST
        else if (q === UV) tc = SWITCH_COST
        else tc = Math.abs(logT[f * K + s] - logT[(f - 1) * K + q])
        const v = pc + tc
        if (v < best) {
          best = v
          arg = q
        }
      }
      cur[s] = best + emis(f, s)
      back[f * S + s] = arg
    }
    const t = prev
    prev = cur
    cur = t
  }
  let state = UV
  let bestEnd = Infinity
  for (let s = 0; s < S; s++)
    if (prev[s] < bestEnd) {
      bestEnd = prev[s]
      state = s
    }
  for (let f = nFrames - 1; f >= 0; f--) {
    if (state !== UV) {
      const tau = candTau[f * K + state]
      f0[f] = sra / tau
      const dv = candDp[f * K + state]
      confidence[f] = Math.max(0, Math.min(1, 1 - dv))
    } else {
      f0[f] = 0
      confidence[f] = 0
    }
    if (f > 0) state = back[f * S + state]
  }

  // ---- median-3 de-blip within voiced runs
  const out = new Float32Array(f0)
  for (let f = 1; f < nFrames - 1; f++) {
    const a = f0[f - 1]
    const b = f0[f]
    const c = f0[f + 1]
    if (a > 0 && b > 0 && c > 0) out[f] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
  }
  onProgress?.(1, 'Analysing pitch')
  return { sampleRate: sr, hopSec, f0: out, confidence }
}

/** f0 (Hz) → fractional MIDI note number. */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440)
}

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12)
}
