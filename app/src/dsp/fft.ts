// In-place iterative radix-2 complex FFT with cached twiddle / bit-reversal tables.

interface Plan {
  n: number
  cos: Float64Array
  sin: Float64Array // -sin(2πk/n) (forward kernel)
  rev: Uint32Array
}

const plans = new Map<number, Plan>()

function getPlan(n: number): Plan {
  let p = plans.get(n)
  if (p) return p
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`)
  const half = n >> 1
  const cos = new Float64Array(half)
  const sin = new Float64Array(half)
  for (let k = 0; k < half; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n)
    sin[k] = -Math.sin((2 * Math.PI * k) / n)
  }
  const rev = new Uint32Array(n)
  let bits = 0
  while (1 << bits < n) bits++
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }
  p = { n, cos, sin, rev }
  plans.set(n, p)
  return p
}

/**
 * In-place complex FFT. `inverse` uses the conjugate kernel and does NOT scale by 1/n.
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length
  const { cos, sin, rev } = getPlan(n)
  for (let i = 0; i < n; i++) {
    const j = rev[i]
    if (j > i) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  const sg = inverse ? -1 : 1
  // size-2 stage (twiddle = 1)
  for (let i = 0; i < n; i += 2) {
    const ar = re[i]
    const ai = im[i]
    const br = re[i + 1]
    const bi = im[i + 1]
    re[i] = ar + br
    im[i] = ai + bi
    re[i + 1] = ar - br
    im[i + 1] = ai - bi
  }
  for (let size = 4; size <= n; size <<= 1) {
    const half = size >> 1
    const step = n / size
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const tr = cos[k]
        const ti = sg * sin[k]
        const a = i + j
        const b = a + half
        const xr = re[b] * tr - im[b] * ti
        const xi = re[b] * ti + im[b] * tr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
}
