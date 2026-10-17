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
  let h = 1 // butterfly span of the next stage
  // odd number of stages: do a plain radix-2 first stage
  let bits = 0
  while (1 << bits < n) bits++
  if (bits & 1) {
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
    h = 2
  }
  // radix-2^2: two radix-2 stages (spans h and 2h) per pass over the data
  while (h < n) {
    const s1 = n / (2 * h) // twiddle stride for W_{2h}
    const s2 = n / (4 * h) // twiddle stride for W_{4h}
    for (let i = 0; i < n; i += 4 * h) {
      for (let j = 0; j < h; j++) {
        const ia = i + j
        const ib = ia + h
        const ic = ib + h
        const id = ic + h
        const w1r = cos[j * s1]
        const w1i = sg * sin[j * s1]
        const w2r = cos[j * s2]
        const w2i = sg * sin[j * s2]
        // stage 1 (span h)
        let tr = re[ib] * w1r - im[ib] * w1i
        let ti = re[ib] * w1i + im[ib] * w1r
        const a1r = re[ia] + tr
        const a1i = im[ia] + ti
        const b1r = re[ia] - tr
        const b1i = im[ia] - ti
        tr = re[id] * w1r - im[id] * w1i
        ti = re[id] * w1i + im[id] * w1r
        const c1r = re[ic] + tr
        const c1i = im[ic] + ti
        const d1r = re[ic] - tr
        const d1i = im[ic] - ti
        // stage 2 (span 2h): (a1,c1) with W_{4h}^j, (b1,d1) with W_{4h}^{j+h} = W_{4h}^j * (-i·sg)
        tr = c1r * w2r - c1i * w2i
        ti = c1r * w2i + c1i * w2r
        re[ia] = a1r + tr
        im[ia] = a1i + ti
        re[ic] = a1r - tr
        im[ic] = a1i - ti
        const er = d1r * w2r - d1i * w2i
        const ei = d1r * w2i + d1i * w2r
        // multiply by -i (forward) / +i (inverse)
        const fr = sg * ei
        const fi = -sg * er
        re[ib] = b1r + fr
        im[ib] = b1i + fi
        re[id] = b1r - fr
        im[id] = b1i - fi
      }
    }
    h *= 4
  }
}
