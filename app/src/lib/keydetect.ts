import type { MusicalKey } from '../types'

// Krumhansl–Schmuckler key detection over a chromagram. Pure TS (worker-safe).

function fftMag(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function corr(a: number[], b: number[]): number {
  const ma = a.reduce((x, y) => x + y, 0) / 12
  const mb = b.reduce((x, y) => x + y, 0) / 12
  let n = 0
  let da = 0
  let db = 0
  for (let i = 0; i < 12; i++) {
    n += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return n / Math.sqrt(da * db + 1e-12)
}

export function detectKey(mono: Float32Array, sampleRate: number): MusicalKey {
  // decimate to ~11 kHz
  const dec = Math.max(1, Math.floor(sampleRate / 11025))
  const sr = sampleRate / dec
  const N = 4096
  const hop = 4096
  const chroma = new Array(12).fill(0)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  const len = Math.floor(mono.length / dec)
  const maxFrames = 400
  const step = Math.max(hop, Math.floor((len - N) / maxFrames))
  for (let s = 0; s + N < len; s += step) {
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)
      re[i] = mono[(s + i) * dec] * w
      im[i] = 0
    }
    fftMag(re, im)
    for (let k = 4; k < N / 2; k++) {
      const f = (k * sr) / N
      if (f < 55 || f > 2000) continue
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k])
      const midi = 69 + 12 * Math.log2(f / 440)
      const pc = ((Math.round(midi) % 12) + 12) % 12
      chroma[pc] += Math.log1p(mag)
    }
  }
  let best: MusicalKey = { tonic: 0, mode: 'major' }
  let bestScore = -Infinity
  for (let t = 0; t < 12; t++) {
    const rot = chroma.map((_, i) => chroma[(i + t) % 12])
    const sMaj = corr(rot, MAJOR)
    const sMin = corr(rot, MINOR)
    if (sMaj > bestScore) {
      bestScore = sMaj
      best = { tonic: t, mode: 'major' }
    }
    if (sMin > bestScore) {
      bestScore = sMin
      best = { tonic: t, mode: 'minor' }
    }
  }
  return best
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
export function keyName(k?: MusicalKey): string {
  if (!k) return ''
  return `${NOTE_NAMES[k.tonic]} ${k.mode}`
}
