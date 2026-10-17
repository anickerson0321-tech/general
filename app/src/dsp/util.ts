// Small numeric helpers shared by the DSP modules. Pure TS, worker/Node safe.

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Hermite smoothstep from 0 (x<=e0) to 1 (x>=e1). */
export function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 === e0) return x < e0 ? 0 : 1
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function dbToLin(db: number): number {
  return Math.pow(10, db / 20)
}

export function linToDb(v: number): number {
  return 20 * Math.log10(Math.max(v, 1e-12))
}

export function powToDb(p: number): number {
  return 10 * Math.log10(Math.max(p, 1e-24))
}

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

/** p in 0..1. Works on a copy; ignores NaN. */
export function percentile(values: ArrayLike<number>, p: number): number {
  const a: number[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v === v) a.push(v)
  }
  if (a.length === 0) return NaN
  a.sort((x, y) => x - y)
  const idx = clamp(p, 0, 1) * (a.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.min(a.length - 1, lo + 1)
  return a[lo] + (a[hi] - a[lo]) * (idx - lo)
}

export function median(values: ArrayLike<number>): number {
  return percentile(values, 0.5)
}

/**
 * Monotone cubic (Fritsch–Carlson) interpolating curve through keypoints.
 * Gives smooth, overshoot-free parameter curves for the amount slider.
 */
export function makeCurve(points: ReadonlyArray<readonly [number, number]>): (x: number) => number {
  const n = points.length
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  if (n === 1) return () => ys[0]
  const d: number[] = []
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]))
  const m: number[] = new Array(n).fill(0)
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = 0
      m[k + 1] = 0
      continue
    }
    const a = m[k] / d[k]
    const b = m[k + 1] / d[k]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[k] = t * a * d[k]
      m[k + 1] = t * b * d[k]
    }
  }
  // flat ends for keypoints whose neighbouring segment is flat
  return (x: number): number => {
    if (!(x > xs[0])) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let k = 0
    while (k < n - 2 && x > xs[k + 1]) k++
    const h = xs[k + 1] - xs[k]
    const t = (x - xs[k]) / h
    const t2 = t * t
    const t3 = t2 * t
    const h00 = 2 * t3 - 3 * t2 + 1
    const h10 = t3 - 2 * t2 + t
    const h01 = -2 * t3 + 3 * t2
    const h11 = t3 - t2
    return h00 * ys[k] + h10 * h * m[k] + h01 * ys[k + 1] + h11 * h * m[k + 1]
  }
}

/** Replace NaN/Infinity by 0 (in place). Returns the buffer. */
export function sanitize(buf: Float32Array): Float32Array {
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]
    if (!(v === v) || v === Infinity || v === -Infinity) buf[i] = 0
  }
  return buf
}

/** 4-point Catmull-Rom interpolation of x at fractional index pos (zero outside). */
export function cubicAt(x: Float32Array, pos: number): number {
  const i = Math.floor(pos)
  const f = pos - i
  const n = x.length
  const xm1 = i - 1 >= 0 && i - 1 < n ? x[i - 1] : 0
  const x0 = i >= 0 && i < n ? x[i] : 0
  const x1 = i + 1 >= 0 && i + 1 < n ? x[i + 1] : 0
  const x2 = i + 2 >= 0 && i + 2 < n ? x[i + 2] : 0
  const c1 = 0.5 * (x1 - xm1)
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
  return ((c3 * f + c2) * f + c1) * f + x0
}

/** Sliding-window maximum over [i - back, i + fwd] (O(n) monotone deque). */
export function slidingMax(src: Float32Array, back: number, fwd: number): Float32Array {
  return slidingExtreme(src, back, fwd, true)
}

/** Sliding-window minimum over [i - back, i + fwd]. */
export function slidingMin(src: Float32Array, back: number, fwd: number): Float32Array {
  return slidingExtreme(src, back, fwd, false)
}

function slidingExtreme(src: Float32Array, back: number, fwd: number, isMax: boolean): Float32Array {
  const n = src.length
  const out = new Float32Array(n)
  const dq = new Int32Array(n + 1)
  let head = 0
  let tail = 0
  let next = 0 // next index to push
  for (let i = 0; i < n; i++) {
    const hiIdx = Math.min(n - 1, i + fwd)
    while (next <= hiIdx) {
      const v = src[next]
      if (isMax) {
        while (tail > head && src[dq[tail - 1]] <= v) tail--
      } else {
        while (tail > head && src[dq[tail - 1]] >= v) tail--
      }
      dq[tail++] = next
      next++
    }
    const loIdx = i - back
    while (dq[head] < loIdx) head++
    out[i] = src[dq[head]]
  }
  return out
}

/** Mulberry32 deterministic PRNG. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
