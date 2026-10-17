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
  const full = new Float32Array(send)
  for (const s of butterworth('highpass', p.lowCutHz, sr, 2)) biquad(full, s)
  biquad(full, designBiquad('lowpass', Math.min(p.highCutHz, sr * 0.42), sr, 0.6))
  if (sr < 44100) return renderReverbCore(full, send, sr, p)
  // run the tank at half rate (the send is already band-limited below ~9.6 kHz)
  const nH = Math.ceil(full.length / 2)
  const half = new Float32Array(nH)
  for (let i = 0; i < nH; i++) {
    const a = i > 0 ? full[2 * i - 1] : 0
    const b = full[2 * i]
    const c = 2 * i + 1 < full.length ? full[2 * i + 1] : 0
    half[i] = 0.25 * a + 0.5 * b + 0.25 * c
  }
  const r = renderReverbCore(half, half, sr / 2, p)
  const rl = r.left
  const rr = r.right
  const n = send.length
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const j = i >> 1
    if (i & 1) {
      const j1 = j + 1 < nH ? j + 1 : j
      left[i] = 0.5 * (rl[j] + rl[j1])
      right[i] = 0.5 * (rr[j] + rr[j1])
    } else {
      left[i] = rl[j]
      right[i] = rr[j]
    }
  }
  const lpf = designBiquad('lowpass', Math.min(10000, sr * 0.22), sr, 0.7)
  biquad(left, lpf)
  biquad(right, lpf)
  // keep the wet/dry energy calibration exact after resampling
  let eIn = 0
  let eOut = 0
  for (let i = 0; i < n; i++) {
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

function renderReverbCore(x: Float32Array, send: Float32Array, sr: number, p: ReverbParams): Stereo {
  const n = x.length
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  const pre = Math.max(0, Math.round((p.preDelayMs / 1000) * sr))

  // ---- pre-delay + early reflections (room character), added straight to the outputs
  const erMs = [7.1, 11.3, 16.9, 23.4, 29.8, 37.2, 44.1]
  const erG = [0.8, 0.7, 0.62, 0.5, 0.42, 0.33, 0.26]
  if (p.early > 0.001) {
    const taps = erMs.map((m) => pre + Math.round(((m * (0.6 + p.size)) / 1000) * sr))
    for (let t = 0; t < taps.length; t++) addDelayed(t & 1 ? right : left, x, taps[t], p.early * erG[t])
  }
  // ---- input diffusion: Schroeder all-passes, whole-buffer passes
  const v = new Float32Array(n)
  for (let i = pre; i < n; i++) v[i] = x[i - pre]
  const apMs = [4.77, 3.6, 12.73, 9.31]
  const apG = [0.75, 0.75, 0.625, 0.625]
  for (let a = 0; a < 4; a++) allpassPass(v, Math.max(1, Math.round((apMs[a] / 1000) * sr)), apG[a] * p.diffusion)

  // ---- 8-line FDN, Hadamard feedback, absorptive damping, two modulated lines
  const base = [31.7, 37.9, 41.3, 47.9, 53.1, 61.7, 67.3, 73.9]
  const scale = 0.45 + 1.0 * p.size
  const L = 8
  const modDepth = (0.0006 + 0.0006 * p.size) * sr
  const dl = new Float64Array(L)
  let maxD = 0
  for (let k = 0; k < L; k++) {
    dl[k] = Math.round((base[k] * scale * sr) / 1000) | 1
    maxD = Math.max(maxD, dl[k])
  }
  let S = 1
  while (S < maxD + modDepth + 8) S <<= 1
  const M = S - 1
  const buf = new Float32Array(S * L)
  const g = new Float64Array(L)
  const dmp = new Float64Array(L)
  for (let k = 0; k < L; k++) {
    g[k] = Math.pow(10, (-3 * dl[k]) / (sr * Math.max(0.1, p.decaySec)))
    dmp[k] = 1 - Math.min(0.85, p.damping * (0.35 + dl[k] / sr / 0.15))
  }
  fdnLoop(v, left, right, buf, S, M, dl, g, dmp, modDepth, sr)
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

function allpassPass(v: Float32Array, len: number, gg: number): void {
  const ring = new Float32Array(len)
  const n = v.length
  let idx = 0
  for (let i = 0; i < n; i++) {
    const d = ring[idx]
    const u = v[i] + gg * d
    ring[idx] = u
    v[i] = d - gg * u
    if (++idx >= len) idx = 0
  }
}

function addDelayed(dst: Float32Array, src: Float32Array, d: number, gg: number): void {
  const n = dst.length
  for (let i = d; i < n; i++) dst[i] += gg * src[i - d]
}

function fdnLoop(
  v: Float32Array,
  left: Float32Array,
  right: Float32Array,
  buf: Float32Array,
  S: number,
  M: number,
  dl: Float64Array,
  g: Float64Array,
  dmp: Float64Array,
  modDepth: number,
  sr: number,
): void {
  const n = v.length
  const L = 8
  const S1 = S, S2 = 2 * S, S3 = 3 * S, S4 = 4 * S, S5 = 5 * S, S6 = 6 * S, S7 = 7 * S
  const [D0, D1, D2, D3, D4, D5, D6, D7] = Array.from(dl)
  const [G0, G1, G2, G3, G4, G5, G6, G7] = Array.from(g)
  const [K0, K1, K2, K3, K4, K5, K6, K7] = Array.from(dmp)
  let l0 = 0, l1 = 0, l2 = 0, l3 = 0, l4 = 0, l5 = 0, l6 = 0, l7 = 0
  // quadrature LFOs (rotating phasors instead of per-sample sin())
  const w0 = (2 * Math.PI * 0.61) / sr
  const w1 = (2 * Math.PI * 0.83) / sr
  const c0r = Math.cos(w0)
  const s0r = Math.sin(w0)
  const c1r = Math.cos(w1)
  const s1r = Math.sin(w1)
  let c0 = 1
  let s0 = 0
  let c1 = 1
  let s1 = 0
  const inScale = 1 / Math.sqrt(L)
  const h = 0.3535533905932738
  for (let i = 0; i < n; i++) {
    let tq = c0 * c0r - s0 * s0r
    s0 = s0 * c0r + c0 * s0r
    c0 = tq
    tq = c1 * c1r - s1 * s1r
    s1 = s1 * c1r + c1 * s1r
    c1 = tq
    if ((i & 4095) === 0) {
      const r0 = 1 / Math.sqrt(c0 * c0 + s0 * s0)
      c0 *= r0
      s0 *= r0
      const r1 = 1 / Math.sqrt(c1 * c1 + s1 * s1)
      c1 *= r1
      s1 *= r1
    }
    {
      const pos = i - D0 + modDepth * s0
      const ip = Math.floor(pos)
      const fr = pos - ip
      const rd = buf[(ip & M)] * (1 - fr) + buf[((ip + 1) & M)] * fr
      l0 += K0 * (rd * G0 - l0)
    }
    l1 += K1 * (buf[S1 + ((i - D1) & M)] * G1 - l1)
    l2 += K2 * (buf[S2 + ((i - D2) & M)] * G2 - l2)
    l3 += K3 * (buf[S3 + ((i - D3) & M)] * G3 - l3)
    l4 += K4 * (buf[S4 + ((i - D4) & M)] * G4 - l4)
    {
      const pos = i - D5 + modDepth * s1
      const ip = Math.floor(pos)
      const fr = pos - ip
      const rd = buf[S5 + (ip & M)] * (1 - fr) + buf[S5 + ((ip + 1) & M)] * fr
      l5 += K5 * (rd * G5 - l5)
    }
    l6 += K6 * (buf[S6 + ((i - D6) & M)] * G6 - l6)
    l7 += K7 * (buf[S7 + ((i - D7) & M)] * G7 - l7)
    const a0 = l0 + l1
    const a1 = l0 - l1
    const a2 = l2 + l3
    const a3 = l2 - l3
    const a4 = l4 + l5
    const a5 = l4 - l5
    const a6 = l6 + l7
    const a7 = l6 - l7
    const b0 = a0 + a2
    const b2 = a0 - a2
    const b1 = a1 + a3
    const b3 = a1 - a3
    const b4 = a4 + a6
    const b6 = a4 - a6
    const b5 = a5 + a7
    const b7 = a5 - a7
    const inj = v[i] * inScale
    const wi = i & M
    buf[wi] = (b0 + b4) * h + inj
    buf[S1 + wi] = (b1 + b5) * h - inj
    buf[S2 + wi] = (b2 + b6) * h + inj
    buf[S3 + wi] = (b3 + b7) * h - inj
    buf[S4 + wi] = (b0 - b4) * h + inj
    buf[S5 + wi] = (b1 - b5) * h - inj
    buf[S6 + wi] = (b2 - b6) * h + inj
    buf[S7 + wi] = (b3 - b7) * h - inj
    // orthogonal output taps
    left[i] += l0 - l1 + l2 - l3 + l4 - l5 + l6 - l7
    right[i] += l0 + l1 - l2 - l3 + l4 + l5 - l6 - l7
  }

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
  delayLoop(x, left, right, dL, dR, Math.min(0.9, Math.max(0, p.feedback)), lpA, p.pingPong)
  if (p.duckDb > 0.01) duck(send, left, right, sr, p.duckDb)
  return { left, right }
}

function delayLoop(
  x: Float32Array,
  left: Float32Array,
  right: Float32Array,
  dL: number,
  dR: number,
  fbk: number,
  lpA: number,
  ping: boolean,
): void {
  const n = x.length
  let lpL = 0
  let lpR = 0
  const inRg = ping ? 0.6 : 1
  for (let i = Math.min(dL, dR); i < n; i++) {
    const jL = i - dL
    const jR = i - dR
    const okL = jL >= 0
    const okR = jR >= 0
    const fbL = okL ? (ping ? right[jL] : left[jL]) : 0
    const fbR = okR ? (ping ? left[jR] : right[jR]) : 0
    lpL = (1 - lpA) * fbL + lpA * lpL
    lpR = (1 - lpA) * fbR + lpA * lpR
    left[i] = (okL ? x[jL] : 0) + fbk * lpL
    right[i] = (okR ? inRg * x[jR] : 0) + fbk * lpR
  }
}

/** Duck a wet return while the dry signal is loud (control rate, 1 ms). */
function duck(dry: Float32Array, left: Float32Array, right: Float32Array, sr: number, duckDb: number): void {
  const n = dry.length
  let pk = 0
  for (let i = 0; i < n; i++) {
    const a = dry[i] < 0 ? -dry[i] : dry[i]
    if (a > pk) pk = a
  }
  if (pk <= 0) return
  const B = Math.max(1, Math.round(sr * 0.001))
  const aA = Math.exp(-1 / 5)
  const aR = Math.exp(-1 / 250)
  const depth = 1 - Math.pow(10, -duckDb / 20)
  let env = 0
  let gPrev = 1
  for (let s0 = 0; s0 < n; s0 += B) {
    const e = Math.min(n, s0 + B)
    let m = 0
    for (let i = s0; i < e; i++) {
      const a = dry[i] < 0 ? -dry[i] : dry[i]
      if (a > m) m = a
    }
    const v = m / pk
    env = v > env ? v + (env - v) * aA : v + (env - v) * aR
    const g = 1 - depth * Math.min(1, env * 3)
    const len = e - s0
    for (let i = s0; i < e; i++) {
      const gi = gPrev + ((g - gPrev) * (i - s0 + 1)) / len
      left[i] *= gi
      right[i] *= gi
    }
    gPrev = g
  }
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
  // slowly wandering delays, evaluated at a 64-sample control rate
  const CR = 64
  const delayAt = (i: number, which: 0 | 1): number => {
    const t = i / sr
    const w =
      which === 0
        ? 0.6 * Math.sin(2 * Math.PI * 0.17 * t) + 0.4 * Math.sin(2 * Math.PI * 0.41 * t + 1.3)
        : 0.6 * Math.sin(2 * Math.PI * 0.13 * t + 2.1) + 0.4 * Math.sin(2 * Math.PI * 0.37 * t + 0.4)
    return (((which === 0 ? p.delayMsL : p.delayMsR) + p.wanderMs * w) / 1000) * sr
  }
  const readInto = (src: Float32Array, dst: Float32Array, which: 0 | 1): void => {
    let dPrev = delayAt(0, which)
    for (let s0 = 0; s0 < n; s0 += CR) {
      const e = Math.min(n, s0 + CR)
      const dNext = delayAt(e, which)
      for (let i = s0; i < e; i++) {
        const d = dPrev + ((dNext - dPrev) * (i - s0)) / CR
        const pos = i - d
        const ii = Math.floor(pos)
        const f = pos - ii
        if (ii >= 1 && ii + 2 < n) {
          const xm1 = src[ii - 1]
          const x0 = src[ii]
          const x1 = src[ii + 1]
          const x2 = src[ii + 2]
          const c1 = 0.5 * (x1 - xm1)
          const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
          const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
          dst[i] = ((c3 * f + c2) * f + c1) * f + x0
        } else dst[i] = cubicAt(src, pos)
      }
      dPrev = dNext
    }
  }
  readInto(dblL, tmpA, 0)
  readInto(dblR, tmpB, 1)
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
