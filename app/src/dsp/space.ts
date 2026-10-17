// Spatial effects: 8-line FDN reverb (room → plate → hall by parameters),
// slap / ping-pong echo with ducking, and modulated-delay stereo doubles.

import { biquad, butterworth, designBiquad } from './biquad'
import { cubicAt } from './util'

export interface ReverbParams {
  decaySec: number // RT60
  size: number // 0..1
  /** 0..1 high-frequency damping */
  damping: number
  preDelayMs: number
  /** 0..1 early reflection level (room character) */
  early: number
  /** 0..1 input diffusion (plate density) */
  diffusion: number
  lowCutHz: number
  highCutHz: number
  width: number // 0..1
}

export interface Stereo {
  left: Float32Array
  right: Float32Array
}

/** Render a 100%-wet stereo reverb of the mono send. Output energy is
 *  normalised to the input energy (so "mix" maps to a wet/dry energy ratio). */
export function renderReverb(send: Float32Array, sr: number, p: ReverbParams): Stereo {
  const n = send.length
  const x = new Float32Array(send)
  for (const s of butterworth('highpass', p.lowCutHz, sr, 2)) biquad(x, s)
  biquad(x, designBiquad('lowpass', p.highCutHz, sr, 0.6))
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  const pre = Math.max(0, Math.round((p.preDelayMs / 1000) * sr))

  // input diffusers (Schroeder all-passes)
  const apMs = [4.77, 3.6, 12.73, 9.31]
  const apG = [0.75, 0.75, 0.625, 0.625].map((g) => g * p.diffusion)
  const apLen = apMs.map((m) => Math.max(1, Math.round((m / 1000) * sr)))
  const apBuf = apLen.map((l) => new Float32Array(l))
  const apIdx = [0, 0, 0, 0]

  // FDN
  const base = [31.7, 37.9, 41.3, 47.9, 53.1, 61.7, 67.3, 73.9]
  const scale = 0.45 + 1.0 * p.size
  const L = 8
  const dl = base.map((ms) => (Math.round((ms * scale * sr) / 1000) | 1) + 0)
  const sizes = dl.map((d) => {
    let s = 1
    while (s < d + 8) s <<= 1
    return s
  })
  const bufs = sizes.map((s) => new Float32Array(s))
  const masks = sizes.map((s) => s - 1)
  const g = dl.map((d) => Math.pow(10, (-3 * d) / (sr * Math.max(0.1, p.decaySec))))
  // damping one-pole: DC gain g, more loss at HF
  const damp = dl.map((d) => Math.min(0.85, p.damping * (0.35 + d / sr / 0.15)))
  const lpState = new Float64Array(L)
  const outs = new Float64Array(L)
  const fbv = new Float64Array(L)
  let wpos = 0
  const modDepth = (0.0006 + 0.0006 * p.size) * sr
  const modRate = [0.61, 0.83]
  const sL = [1, -1, 1, -1, 1, -1, 1, -1]
  const sR = [1, 1, -1, -1, 1, 1, -1, -1]
  const inScale = 1 / Math.sqrt(L)
  // early reflections (tapped delay of the send)
  const erMs = [7.1, 11.3, 16.9, 23.4, 29.8, 37.2, 44.1]
  const erG = [0.8, 0.7, 0.62, 0.5, 0.42, 0.33, 0.26]
  const erTaps = erMs.map((m) => Math.round(((m * (0.6 + p.size)) / 1000) * sr))

  for (let i = 0; i < n; i++) {
    let v = i - pre >= 0 ? x[i - pre] : 0
    for (let a = 0; a < 4; a++) {
      const buf = apBuf[a]
      const idx = apIdx[a]
      const d = buf[idx]
      const gg = apG[a]
      const u = v + gg * d
      buf[idx] = u
      v = d - gg * u
      apIdx[a] = idx + 1 >= apLen[a] ? 0 : idx + 1
    }
    // read delay lines (two modulated)
    for (let k = 0; k < L; k++) {
      let rd: number
      if (k === 0 || k === 5) {
        const m = modDepth * Math.sin((2 * Math.PI * modRate[k === 0 ? 0 : 1] * i) / sr)
        const pos = wpos - dl[k] + m
        const ip = Math.floor(pos)
        const fr = pos - ip
        const b = bufs[k]
        const mk = masks[k]
        rd = b[ip & mk] * (1 - fr) + b[(ip + 1) & mk] * fr
      } else rd = bufs[k][(wpos - dl[k]) & masks[k]]
      // absorptive damping
      const s = lpState[k] + (1 - damp[k]) * (rd * g[k] - lpState[k])
      lpState[k] = s
      outs[k] = s
    }
    // Hadamard (FWHT)
    let a0 = outs[0] + outs[1]
    let a1 = outs[0] - outs[1]
    let a2 = outs[2] + outs[3]
    let a3 = outs[2] - outs[3]
    let a4 = outs[4] + outs[5]
    let a5 = outs[4] - outs[5]
    let a6 = outs[6] + outs[7]
    let a7 = outs[6] - outs[7]
    const b0 = a0 + a2
    const b2 = a0 - a2
    const b1 = a1 + a3
    const b3 = a1 - a3
    const b4 = a4 + a6
    const b6 = a4 - a6
    const b5 = a5 + a7
    const b7 = a5 - a7
    const h = 0.3535533905932738
    a0 = (b0 + b4) * h
    a4 = (b0 - b4) * h
    a1 = (b1 + b5) * h
    a5 = (b1 - b5) * h
    a2 = (b2 + b6) * h
    a6 = (b2 - b6) * h
    a3 = (b3 + b7) * h
    a7 = (b3 - b7) * h
    fbv[0] = a0
    fbv[1] = a1
    fbv[2] = a2
    fbv[3] = a3
    fbv[4] = a4
    fbv[5] = a5
    fbv[6] = a6
    fbv[7] = a7
    const inj = v * inScale
    let oL = 0
    let oR = 0
    for (let k = 0; k < L; k++) {
      bufs[k][wpos & masks[k]] = fbv[k] + inj * (k & 1 ? -1 : 1)
      oL += sL[k] * outs[k]
      oR += sR[k] * outs[k]
    }
    wpos++
    let eL = 0
    let eR = 0
    if (p.early > 0.001) {
      for (let t = 0; t < erTaps.length; t++) {
        const j = i - pre - erTaps[t]
        if (j < 0) continue
        if (t & 1) eR += erG[t] * x[j]
        else eL += erG[t] * x[j]
      }
    }
    left[i] = oL + p.early * eL
    right[i] = oR + p.early * eR
  }
  // width (M/S) and energy normalisation
  const wd = Math.max(0, Math.min(1, p.width))
  let eIn = 0
  let eOut = 0
  for (let i = 0; i < n; i++) {
    const m = 0.5 * (left[i] + right[i])
    const s = 0.5 * (left[i] - right[i]) * wd
    left[i] = m + s
    right[i] = m - s
    eIn += send[i] * send[i]
    eOut += left[i] * left[i] + right[i] * right[i]
  }
  const norm = eOut > 1e-20 ? Math.sqrt((2 * eIn) / eOut) : 0
  for (let i = 0; i < n; i++) {
    left[i] *= norm
    right[i] *= norm
  }
  return { left, right }
}

export interface DelayParams {
  msL: number
  msR: number
  feedback: number // 0..0.9
  pingPong: boolean
  lowCutHz: number
  highCutHz: number
  /** duck the return while the dry vocal is loud (dB) */
  duckDb: number
}

/** 100%-wet stereo delay return. */
export function renderDelay(send: Float32Array, sr: number, p: DelayParams): Stereo {
  const n = send.length
  const x = new Float32Array(send)
  biquad(x, designBiquad('highpass', p.lowCutHz, sr, 0.7))
  biquad(x, designBiquad('lowpass', p.highCutHz, sr, 0.7))
  const dL = Math.max(1, Math.round((p.msL / 1000) * sr))
  const dR = Math.max(1, Math.round((p.msR / 1000) * sr))
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  // loop filter (one-pole low-pass) keeps repeats darker
  const lpA = Math.exp((-2 * Math.PI * p.highCutHz * 0.8) / sr)
  let lpL = 0
  let lpR = 0
  const fbk = Math.min(0.9, Math.max(0, p.feedback))
  for (let i = 0; i < n; i++) {
    const inL = i - dL >= 0 ? x[i - dL] : 0
    const inR = i - dR >= 0 ? x[i - dR] : 0
    const fbL = i - dL >= 0 ? (p.pingPong ? right[i - dL] : left[i - dL]) : 0
    const fbR = i - dR >= 0 ? (p.pingPong ? left[i - dR] : right[i - dR]) : 0
    lpL = (1 - lpA) * fbL + lpA * lpL
    lpR = (1 - lpA) * fbR + lpA * lpR
    left[i] = inL + fbk * lpL
    right[i] = (p.pingPong ? 0.6 * inR : inR) + fbk * lpR
  }
  if (p.duckDb > 0.01) {
    // envelope of the dry send (fast attack, slow release)
    const aA = Math.exp(-1 / (0.005 * sr))
    const aR = Math.exp(-1 / (0.25 * sr))
    let env = 0
    let pk = 0
    for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(send[i]))
    const ref = pk > 0 ? pk : 1
    const depth = 1 - Math.pow(10, -p.duckDb / 20)
    for (let i = 0; i < n; i++) {
      const v = Math.abs(send[i]) / ref
      env = v > env ? v + (env - v) * aA : v + (env - v) * aR
      const g = 1 - depth * Math.min(1, env * 3)
      left[i] *= g
      right[i] *= g
    }
  }
  return { left, right }
}

export interface DoubleParams {
  /** base delays of the two doubles (ms) */
  delayMsL: number
  delayMsR: number
  /** slow timing wander (ms) */
  wanderMs: number
  /** 0..1 pan width of the doubles */
  width: number
}

/** Place two (already pitch-offset) copies with slowly wandering delays, panned L/R. */
export function placeDoubles(dblL: Float32Array, dblR: Float32Array, sr: number, p: DoubleParams): Stereo {
  const n = dblL.length
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  const th = (Math.PI / 4) * (1 - Math.max(0, Math.min(1, p.width)))
  // equal-power pan: double A towards left, double B towards right
  const aL = Math.cos(th)
  const aR = Math.sin(th)
  const tmpA = new Float32Array(n)
  const tmpB = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const wa = 0.6 * Math.sin(2 * Math.PI * 0.17 * t) + 0.4 * Math.sin(2 * Math.PI * 0.41 * t + 1.3)
    const wb = 0.6 * Math.sin(2 * Math.PI * 0.13 * t + 2.1) + 0.4 * Math.sin(2 * Math.PI * 0.37 * t + 0.4)
    const da = ((p.delayMsL + p.wanderMs * wa) / 1000) * sr
    const db = ((p.delayMsR + p.wanderMs * wb) / 1000) * sr
    tmpA[i] = cubicAt(dblL, i - da)
    tmpB[i] = cubicAt(dblR, i - db)
  }
  for (const c of [tmpA, tmpB]) {
    biquad(c, designBiquad('highpass', 140, sr, 0.7))
    biquad(c, designBiquad('lowpass', 9000, sr, 0.7))
  }
  for (let i = 0; i < n; i++) {
    left[i] = aL * tmpA[i] + aR * tmpB[i]
    right[i] = aR * tmpA[i] + aL * tmpB[i]
  }
  return { left, right }
}
