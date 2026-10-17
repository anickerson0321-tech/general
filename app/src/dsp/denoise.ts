// Gentle stationary-noise reduction (hiss, hum floor, fans, phone-mic noise).
// STFT (sqrt-Hann, 50% overlap, perfect reconstruction), noise PSD from the
// quietest frames, decision-directed Wiener gains with a depth floor and
// frequency smoothing to avoid musical noise. Two real frames are packed into
// one complex FFT.

import { fft } from './fft'
import { percentile } from './util'

export interface DenoiseResult {
  out: Float32Array
  /** effective depth actually applied (dB) */
  depthDb: number
  noiseDb: number
}

export function spectralDenoise(x: Float32Array, sr: number, depthDb: number): DenoiseResult {
  const n = x.length
  if (depthDb <= 0.05 || n < 4096) return { out: new Float32Array(x), depthDb: 0, noiseDb: -120 }
  const N = sr > 32000 ? 2048 : 1024
  const H = N >> 1
  const K = (N >> 1) + 1
  const win = new Float64Array(N)
  for (let i = 0; i < N; i++) win[i] = Math.sin((Math.PI * i) / N)
  const nFrames = Math.ceil((n + H) / H) + 1
  const frameStart = (f: number): number => f * H - H

  // --- frame energies and quiet-frame selection
  const fe = new Float32Array(nFrames)
  for (let f = 0; f < nFrames; f++) {
    const s0 = frameStart(f)
    let e = 0
    for (let i = 0; i < N; i += 2) {
      const idx = s0 + i
      if (idx >= 0 && idx < n) e += x[idx] * x[idx]
    }
    fe[f] = 10 * Math.log10((2 * e) / N + 1e-20)
  }
  const valid: number[] = []
  for (let f = 0; f < nFrames; f++) if (fe[f] > -110) valid.push(fe[f])
  if (valid.length < 8) return { out: new Float32Array(x), depthDb: 0, noiseDb: -120 }
  const qDb = percentile(valid, 0.12)
  const loudDb = percentile(valid, 0.9)
  // no clear noise floor (sung throughout / music bleed): back off
  const confidence = Math.max(0, Math.min(1, (loudDb - qDb - 12) / 15))
  const depth = depthDb * confidence
  if (depth <= 0.1) return { out: new Float32Array(x), depthDb: 0, noiseDb: qDb }

  const re = new Float64Array(N)
  const im = new Float64Array(N)
  const noise = new Float64Array(K)
  let cnt = 0
  const thr = qDb + 1.5
  const fillPair = (fa: number, fb: number): void => {
    const sa = frameStart(fa)
    const sb = frameStart(fb)
    for (let i = 0; i < N; i++) {
      const ia = sa + i
      const ib = sb + i
      re[i] = ia >= 0 && ia < n ? x[ia] * win[i] : 0
      im[i] = fb >= 0 && ib >= 0 && ib < n ? x[ib] * win[i] : 0
    }
    fft(re, im)
  }
  const quiet: number[] = []
  for (let f = 0; f < nFrames; f++) if (fe[f] <= thr && fe[f] > -110) quiet.push(f)
  for (let q = 0; q < quiet.length; q += 2) {
    const fa = quiet[q]
    const fb = q + 1 < quiet.length ? quiet[q + 1] : -1
    fillPair(fa, fb)
    for (let k = 0; k < K; k++) {
      const m = (N - k) & (N - 1)
      const ar = 0.5 * (re[k] + re[m])
      const ai = 0.5 * (im[k] - im[m])
      noise[k] += ar * ar + ai * ai
      if (fb >= 0) {
        const br = 0.5 * (im[k] + im[m])
        const bi = 0.5 * (re[m] - re[k])
        noise[k] += br * br + bi * bi
      }
    }
    cnt += fb >= 0 ? 2 : 1
  }
  if (cnt === 0) return { out: new Float32Array(x), depthDb: 0, noiseDb: qDb }
  const lam = new Float64Array(K)
  for (let k = 0; k < K; k++) {
    let s = 0
    let c = 0
    for (let j = Math.max(0, k - 2); j <= Math.min(K - 1, k + 2); j++) {
      s += noise[j]
      c++
    }
    lam[k] = (1.4 * s) / c / cnt + 1e-20 // over-subtraction factor 1.4
  }

  // --- processing pass
  const floor = Math.pow(10, -depth / 20)
  const alpha = 0.97
  const prevClean = new Float64Array(K) // |S|^2 of previous frame
  const G = new Float64Array(K)
  const Gs = new Float64Array(K)
  const Xr = new Float64Array(K)
  const Xi = new Float64Array(K)
  const Yr = [new Float64Array(K), new Float64Array(K)]
  const Yi = [new Float64Array(K), new Float64Array(K)]
  const out = new Float32Array(n)
  const Br = new Float64Array(K)
  const Bi = new Float64Array(K)
  const gainsFor = (slot: number): void => {
    for (let k = 0; k < K; k++) {
      const p = Xr[k] * Xr[k] + Xi[k] * Xi[k]
      const gamma = p / lam[k]
      const xi = alpha * (prevClean[k] / lam[k]) + (1 - alpha) * Math.max(gamma - 1, 0)
      G[k] = xi / (1 + xi)
    }
    for (let k = 0; k < K; k++) {
      const a = G[k > 0 ? k - 1 : k]
      const c = G[k < K - 1 ? k + 1 : k]
      let g = 0.25 * a + 0.5 * G[k] + 0.25 * c
      if (g < floor) g = floor
      Gs[k] = g
    }
    // leave sub-bass and DC alone (already high-passed)
    const yr = Yr[slot]
    const yi = Yi[slot]
    for (let k = 0; k < K; k++) {
      const g = Gs[k]
      yr[k] = Xr[k] * g
      yi[k] = Xi[k] * g
      prevClean[k] = (yr[k] * yr[k] + yi[k] * yi[k])
    }
  }
  for (let f = 0; f < nFrames; f += 2) {
    const fb = f + 1 < nFrames ? f + 1 : -1
    fillPair(f, fb)
    // unpack frame a
    for (let k = 0; k < K; k++) {
      const m = (N - k) & (N - 1)
      Xr[k] = 0.5 * (re[k] + re[m])
      Xi[k] = 0.5 * (im[k] - im[m])
    }
    // keep frame b's spectrum before overwriting Xr/Xi
    if (fb >= 0)
      for (let k = 0; k < K; k++) {
        const m = (N - k) & (N - 1)
        Br[k] = 0.5 * (im[k] + im[m])
        Bi[k] = 0.5 * (re[m] - re[k])
      }
    gainsFor(0)
    if (fb >= 0) {
      Xr.set(Br)
      Xi.set(Bi)
      gainsFor(1)
    } else {
      Yr[1].fill(0)
      Yi[1].fill(0)
    }
    // pack Y = Ya + i·Yb (both Hermitian) and inverse transform
    for (let k = 0; k < K; k++) {
      const ar = Yr[0][k]
      const ai = Yi[0][k]
      const br = Yr[1][k]
      const bi = Yi[1][k]
      re[k] = ar - bi
      im[k] = ai + br
      if (k > 0 && k < N - k) {
        // conj-symmetric partners: Ya[N-k] = conj(Ya[k]), Yb likewise
        re[N - k] = ar + bi
        im[N - k] = -ai + br
      }
    }
    fft(re, im, true)
    const sa = frameStart(f)
    const sb = frameStart(fb)
    const inv = 1 / N
    for (let i = 0; i < N; i++) {
      const ia = sa + i
      if (ia >= 0 && ia < n) out[ia] += re[i] * inv * win[i]
      if (fb >= 0) {
        const ib = sb + i
        if (ib >= 0 && ib < n) out[ib] += im[i] * inv * win[i]
      }
    }
  }
  return { out, depthDb: depth, noiseDb: qDb }
}
