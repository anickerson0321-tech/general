// Spatial effects: 8-line FDN reverb (room → plate → hall by parameters),
// slap / ping-pong echo with ducking, and modulated-delay stereo doubles.
//
// Everything streams in small blocks and ACCUMULATES into the caller's wet bus
// (no full-length temporaries) so the whole chain fits a phone's Web Worker.

import { STREAM_BLOCK, butterworth, cascadeState, cascadeStream, designBiquad } from './biquad'
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

/** Destination of a wet return: stereo bus plus (optionally) the reverb send. */
export interface WetBus {
  left: Float32Array
  right: Float32Array
  send?: Float32Array
}

// ---------------------------------------------------------------- reverb

/**
 * 100%-wet stereo FDN reverb of `send`, normalised so that its energy equals the
 * (unfiltered) send energy, scaled by `gain` and ADDED to `bus`.
 * Low-memory: the band-limited send lives in a small ring buffer; the tank's left output
 * goes to `scratchL` and its right output is written back INTO `send` (which is consumed).
 */
export function addReverb(send: Float32Array, sr: number, p: ReverbParams, gain: number, bus: WetBus, scratchL: Float32Array): void {
  const n = send.length
  const pre = [...butterworth('highpass', p.lowCutHz, sr, 2), designBiquad('lowpass', Math.min(p.highCutHz, sr * 0.42), sr, 0.6)]
  const fst = cascadeState(pre)
  const left = scratchL
  const right = send
  const preD = Math.max(0, Math.round((p.preDelayMs / 1000) * sr))

  // early reflections (room character)
  const erMs = [7.1, 11.3, 16.9, 23.4, 29.8, 37.2, 44.1]
  const erG = [0.8, 0.7, 0.62, 0.5, 0.42, 0.33, 0.26]
  const useEr = p.early > 0.001
  const erD = erMs.map((m) => preD + Math.round(((m * (0.6 + p.size)) / 1000) * sr))
  const erGain = erG.map((g) => p.early * g)
  // ring of the band-limited send: covers pre-delay + longest reflection + one block
  let RS = 1
  while (RS < Math.max(preD, ...erD) + STREAM_BLOCK + 8) RS <<= 1
  const RM = RS - 1
  const ring = new Float32Array(RS)

  // input diffusers (Schroeder all-passes), streamed in blocks
  const apMs = [4.77, 3.6, 12.73, 9.31]
  const apG = [0.75, 0.75, 0.625, 0.625].map((g) => g * p.diffusion)
  const aps = apMs.map((m) => ({ ring: new Float32Array(Math.max(1, Math.round((m / 1000) * sr))), idx: 0 }))

  // 8-line FDN, Hadamard feedback, absorptive damping, two modulated lines
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
  const tank: FdnTank = {
    buf: new Float32Array(S * L),
    S,
    dl,
    g: new Float64Array(L),
    dmp: new Float64Array(L),
    modDepth,
    sr,
    st: Float64Array.from([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0]),
  }
  for (let k = 0; k < L; k++) {
    tank.g[k] = Math.pow(10, (-3 * dl[k]) / (sr * Math.max(0.1, p.decaySec)))
    tank.dmp[k] = 1 - Math.min(0.85, p.damping * (0.35 + dl[k] / sr / 0.15))
  }
  const blk = new Float32Array(STREAM_BLOCK)
  const v = new Float32Array(STREAM_BLOCK)
  const oL = new Float32Array(STREAM_BLOCK)
  const oR = new Float32Array(STREAM_BLOCK)
  let eIn = 0
  for (let b0 = 0; b0 < n; b0 += STREAM_BLOCK) {
    const m = Math.min(STREAM_BLOCK, n - b0)
    for (let j = 0; j < m; j++) {
      const raw = send[b0 + j]
      eIn += raw * raw
      blk[j] = raw
    }
    cascadeStream(blk, pre, fst, m)
    for (let j = 0; j < m; j++) ring[(b0 + j) & RM] = blk[j]
    oL.fill(0)
    oR.fill(0)
    if (useEr)
      for (let t = 0; t < erD.length; t++) {
        const d = erD[t]
        const gg = erGain[t]
        const dst = t & 1 ? oR : oL
        for (let j = Math.max(0, d - b0); j < m; j++) dst[j] += gg * ring[(b0 + j - d) & RM]
      }
    for (let j = 0; j < m; j++) {
      const i = b0 + j
      v[j] = i - preD >= 0 ? ring[(i - preD) & RM] : 0
    }
    for (let a = 0; a < 4; a++) allpassBlock(v, m, aps[a], apG[a])
    fdnBlock(tank, v, m, b0, oL, oR)
    for (let j = 0; j < m; j++) {
      left[b0 + j] = oL[j]
      right[b0 + j] = oR[j] // the send sample at b0+j is already safe in the ring
    }
  }
  // width (M/S), energy normalisation, accumulate
  const wd = Math.max(0, Math.min(1, p.width))
  let eOut = 0
  for (let i = 0; i < n; i++) {
    const mid = 0.5 * (left[i] + right[i])
    const side = 0.5 * (left[i] - right[i]) * wd
    left[i] = mid + side
    right[i] = mid - side
    eOut += left[i] * left[i] + right[i] * right[i]
  }
  const norm = eOut > 1e-20 ? Math.sqrt((2 * eIn) / eOut) : 0
  const g = gain * norm
  const bl = bus.left
  const br = bus.right
  for (let i = 0; i < n; i++) {
    bl[i] += g * left[i]
    br[i] += g * right[i]
  }
}

function allpassBlock(v: Float32Array, m: number, ap: { ring: Float32Array; idx: number }, gg: number): void {
  const ring = ap.ring
  const len = ring.length
  let idx = ap.idx
  for (let i = 0; i < m; i++) {
    const d = ring[idx]
    const u = v[i] + gg * d
    ring[idx] = u
    v[i] = d - gg * u
    if (++idx >= len) idx = 0
  }
  ap.idx = idx
}

interface FdnTank {
  buf: Float32Array
  S: number
  dl: Float64Array
  g: Float64Array
  dmp: Float64Array
  modDepth: number
  sr: number
  /** l0..l7, c0, s0, c1, s1 */
  st: Float64Array
}

/** Run the tank over one block of diffused input v[0..m) at absolute sample offset i0, adding to out blocks oL/oR[0..m). */
function fdnBlock(tk: FdnTank, v: Float32Array, m: number, i0: number, left: Float32Array, right: Float32Array): void {
  const { buf, S, modDepth, sr } = tk
  const M = S - 1
  const S1 = S, S2 = 2 * S, S3 = 3 * S, S4 = 4 * S, S5 = 5 * S, S6 = 6 * S, S7 = 7 * S
  const [D0, D1, D2, D3, D4, D5, D6, D7] = Array.from(tk.dl)
  const [G0, G1, G2, G3, G4, G5, G6, G7] = Array.from(tk.g)
  const [K0, K1, K2, K3, K4, K5, K6, K7] = Array.from(tk.dmp)
  const st = tk.st
  let l0 = st[0], l1 = st[1], l2 = st[2], l3 = st[3], l4 = st[4], l5 = st[5], l6 = st[6], l7 = st[7]
  let c0 = st[8]
  let s0 = st[9]
  let c1 = st[10]
  let s1 = st[11]
  // quadrature LFOs (rotating phasors instead of per-sample sin())
  const w0 = (2 * Math.PI * 0.61) / sr
  const w1 = (2 * Math.PI * 0.83) / sr
  const c0r = Math.cos(w0)
  const s0r = Math.sin(w0)
  const c1r = Math.cos(w1)
  const s1r = Math.sin(w1)
  const inScale = 1 / Math.sqrt(8)
  const h = 0.3535533905932738
  for (let j = 0; j < m; j++) {
    const i = i0 + j
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
      const rd = buf[ip & M] * (1 - fr) + buf[(ip + 1) & M] * fr
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
    const inj = v[j] * inScale
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
    left[j] += l0 - l1 + l2 - l3 + l4 - l5 + l6 - l7
    right[j] += l0 + l1 - l2 - l3 + l4 + l5 - l6 - l7
  }
  st[0] = l0
  st[1] = l1
  st[2] = l2
  st[3] = l3
  st[4] = l4
  st[5] = l5
  st[6] = l6
  st[7] = l7
  st[8] = c0
  st[9] = s0
  st[10] = c1
  st[11] = s1
}

// ---------------------------------------------------------------- delays

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

/**
 * Stereo delay of `dry` (band-limited, optional ping-pong feedback, ducked by the dry
 * level) scaled by `gain` and ADDED to the bus; `sendGain` × (L+R) also goes to bus.send.
 * Streams with ring buffers: memory O(delay length).
 */
export function addDelay(dry: Float32Array, sr: number, p: DelayParams, gain: number, bus: WetBus, sendGain = 0): void {
  const n = dry.length
  const dL = Math.max(1, Math.round((p.msL / 1000) * sr))
  const dR = Math.max(1, Math.round((p.msR / 1000) * sr))
  const R = Math.max(dL, dR) + 1
  const xr = new Float32Array(R) // filtered input history
  const yl = new Float32Array(R) // raw (pre-duck) output history
  const yr = new Float32Array(R)
  const filt = [designBiquad('highpass', p.lowCutHz, sr, 0.7), designBiquad('lowpass', p.highCutHz, sr, 0.7)]
  const fst = cascadeState(filt)
  const lpA = Math.exp((-2 * Math.PI * p.highCutHz * 0.8) / sr)
  const fbk = Math.min(0.9, Math.max(0, p.feedback))
  const ping = p.pingPong
  const inRg = ping ? 0.6 : 1
  const dMin = Math.min(dL, dR)
  // ducking (control rate 1 ms) — global dry peak as reference
  const duck = p.duckDb > 0.01
  let pk = 0
  if (duck)
    for (let i = 0; i < n; i++) {
      const a = dry[i] < 0 ? -dry[i] : dry[i]
      if (a > pk) pk = a
    }
  const useDuck = duck && pk > 0
  const B = Math.max(1, Math.round(sr * 0.001))
  const aA = Math.exp(-1 / 5)
  const aRl = Math.exp(-1 / 250)
  const depth = 1 - Math.pow(10, -p.duckDb / 20)
  let env = 0
  let gPrev = 1
  const blk = new Float32Array(B)
  let lpL = 0
  let lpR = 0
  const bl = bus.left
  const br = bus.right
  const bs = bus.send
  const sg = gain * sendGain
  for (let s0 = 0; s0 < n; s0 += B) {
    const e = Math.min(n, s0 + B)
    const len = e - s0
    for (let i = s0; i < e; i++) blk[i - s0] = dry[i]
    cascadeStream(blk, filt, fst, len)
    let g = 1
    if (useDuck) {
      let m = 0
      for (let i = s0; i < e; i++) {
        const a = dry[i] < 0 ? -dry[i] : dry[i]
        if (a > m) m = a
      }
      const v = m / pk
      env = v > env ? v + (env - v) * aA : v + (env - v) * aRl
      g = 1 - depth * Math.min(1, env * 3)
    }
    for (let i = s0; i < e; i++) {
      xr[i % R] = blk[i - s0]
      let outL = 0
      let outR = 0
      if (i >= dMin) {
        const jL = i - dL
        const jR = i - dR
        const okL = jL >= 0
        const okR = jR >= 0
        const fbL = okL ? (ping ? yr[jL % R] : yl[jL % R]) : 0
        const fbR = okR ? (ping ? yl[jR % R] : yr[jR % R]) : 0
        lpL = (1 - lpA) * fbL + lpA * lpL
        lpR = (1 - lpA) * fbR + lpA * lpR
        outL = Math.fround((okL ? xr[jL % R] : 0) + fbk * lpL)
        outR = Math.fround((okR ? inRg * xr[jR % R] : 0) + fbk * lpR)
      }
      yl[i % R] = outL
      yr[i % R] = outR
      const gi = useDuck ? gPrev + ((g - gPrev) * (i - s0 + 1)) / len : 1
      const oL = outL * gi
      const oR = outR * gi
      bl[i] += gain * oL
      br[i] += gain * oR
      if (bs && sg > 0) bs[i] += sg * (oL + oR)
    }
    gPrev = g
  }
}

// ---------------------------------------------------------------- doubles

export interface DoubleParams {
  /** base delays of the two doubles (ms) */
  delayMsL: number
  delayMsR: number
  /** slow timing wander (ms) */
  wanderMs: number
  /** 0..1 pan width of the doubles */
  width: number
}

/**
 * Place ONE (already pitch-offset) double with a slowly wandering delay, band-limit it,
 * pan it (which = 0 → towards left, 1 → towards right), scale by `gain` and ADD to the bus;
 * `sendGain` × (L+R) goes to bus.send. Streams in blocks.
 */
export function addDouble(src: Float32Array, sr: number, which: 0 | 1, p: DoubleParams, gain: number, bus: WetBus, sendGain = 0): void {
  const n = src.length
  const th = (Math.PI / 4) * (1 - Math.max(0, Math.min(1, p.width)))
  const aL = Math.cos(th)
  const aR = Math.sin(th)
  const gl = gain * (which === 0 ? aL : aR)
  const gr = gain * (which === 0 ? aR : aL)
  const gs = gain * sendGain * (aL + aR)
  const band = [designBiquad('highpass', 140, sr, 0.7), designBiquad('lowpass', Math.min(9000, sr * 0.42), sr, 0.7)]
  const fst = cascadeState(band)
  const CR = 64 // control rate for the delay wander (STREAM_BLOCK is a multiple)
  const delayAt = (i: number): number => {
    const t = i / sr
    const w =
      which === 0
        ? 0.6 * Math.sin(2 * Math.PI * 0.17 * t) + 0.4 * Math.sin(2 * Math.PI * 0.41 * t + 1.3)
        : 0.6 * Math.sin(2 * Math.PI * 0.13 * t + 2.1) + 0.4 * Math.sin(2 * Math.PI * 0.37 * t + 0.4)
    return (((which === 0 ? p.delayMsL : p.delayMsR) + p.wanderMs * w) / 1000) * sr
  }
  const blk = new Float32Array(STREAM_BLOCK)
  const bl = bus.left
  const br = bus.right
  const bs = bus.send
  for (let b0 = 0; b0 < n; b0 += STREAM_BLOCK) {
    const bEnd = Math.min(n, b0 + STREAM_BLOCK)
    let dPrev = delayAt(b0)
    for (let s0 = b0; s0 < bEnd; s0 += CR) {
      const e = Math.min(n, s0 + CR)
      const dNext = delayAt(e)
      for (let i = s0; i < e; i++) {
        const d = dPrev + ((dNext - dPrev) * (i - s0)) / CR
        const pos = i - d
        const ii = Math.floor(pos)
        const f = pos - ii
        let v: number
        if (ii >= 1 && ii + 2 < n) {
          const xm1 = src[ii - 1]
          const x0 = src[ii]
          const x1 = src[ii + 1]
          const x2 = src[ii + 2]
          const c1 = 0.5 * (x1 - xm1)
          const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
          const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
          v = ((c3 * f + c2) * f + c1) * f + x0
        } else v = cubicAt(src, pos)
        blk[i - b0] = v
      }
      dPrev = dNext
    }
    const m = bEnd - b0
    cascadeStream(blk, band, fst, m)
    for (let j = 0; j < m; j++) {
      const v = blk[j]
      bl[b0 + j] += gl * v
      br[b0 + j] += gr * v
      if (bs && gs > 0) bs[b0 + j] += gs * v
    }
  }
}
