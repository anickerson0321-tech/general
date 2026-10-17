// RBJ-cookbook biquads (transposed direct form II, double precision state).

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peak' | 'lowshelf' | 'highshelf'

export interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

export const IDENTITY: Biquad = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }

/** Butterworth section Qs. */
export const BUTTER4_Q = [0.541196100146197, 1.306562964876377]
export const BUTTER8_Q = [0.509795579104159, 0.601344886935045, 0.899976223136416, 2.562915447741505]

export function designBiquad(type: BiquadType, freq: number, sr: number, q = Math.SQRT1_2, gainDb = 0): Biquad {
  const f = Math.min(Math.max(freq, 1), sr * 0.4999)
  const w0 = (2 * Math.PI * f) / sr
  const cw = Math.cos(w0)
  const sw = Math.sin(w0)
  const alpha = sw / (2 * q)
  const A = Math.pow(10, gainDb / 40)
  let b0 = 1
  let b1 = 0
  let b2 = 0
  let a0 = 1
  let a1 = 0
  let a2 = 0
  switch (type) {
    case 'lowpass':
      b0 = (1 - cw) / 2
      b1 = 1 - cw
      b2 = (1 - cw) / 2
      a0 = 1 + alpha
      a1 = -2 * cw
      a2 = 1 - alpha
      break
    case 'highpass':
      b0 = (1 + cw) / 2
      b1 = -(1 + cw)
      b2 = (1 + cw) / 2
      a0 = 1 + alpha
      a1 = -2 * cw
      a2 = 1 - alpha
      break
    case 'bandpass': // constant 0 dB peak gain
      b0 = alpha
      b1 = 0
      b2 = -alpha
      a0 = 1 + alpha
      a1 = -2 * cw
      a2 = 1 - alpha
      break
    case 'notch':
      b0 = 1
      b1 = -2 * cw
      b2 = 1
      a0 = 1 + alpha
      a1 = -2 * cw
      a2 = 1 - alpha
      break
    case 'peak':
      b0 = 1 + alpha * A
      b1 = -2 * cw
      b2 = 1 - alpha * A
      a0 = 1 + alpha / A
      a1 = -2 * cw
      a2 = 1 - alpha / A
      break
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha
      b0 = A * (A + 1 - (A - 1) * cw + s)
      b1 = 2 * A * (A - 1 - (A + 1) * cw)
      b2 = A * (A + 1 - (A - 1) * cw - s)
      a0 = A + 1 + (A - 1) * cw + s
      a1 = -2 * (A - 1 + (A + 1) * cw)
      a2 = A + 1 + (A - 1) * cw - s
      break
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha
      b0 = A * (A + 1 + (A - 1) * cw + s)
      b1 = -2 * A * (A - 1 + (A + 1) * cw)
      b2 = A * (A + 1 + (A - 1) * cw - s)
      a0 = A + 1 - (A - 1) * cw + s
      a1 = 2 * (A - 1 - (A + 1) * cw)
      a2 = A + 1 - (A - 1) * cw - s
      break
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/** Filter `src` into `dst` (may be the same array). */
export function biquad(src: Float32Array, c: Biquad, dst: Float32Array = src): Float32Array {
  const { b0, b1, b2, a1, a2 } = c
  let z1 = 0
  let z2 = 0
  const n = src.length
  for (let i = 0; i < n; i++) {
    const x = src[i]
    const y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    dst[i] = y
  }
  // flush denormal-ish state is irrelevant for JS doubles
  return dst
}

/** Two sections fused in one loop (independent recursions overlap in the CPU pipeline). */
function cascade2(buf: Float32Array, p: Biquad, q: Biquad): void {
  const { b0, b1, b2, a1, a2 } = p
  const c0 = q.b0
  const c1 = q.b1
  const c2 = q.b2
  const d1 = q.a1
  const d2 = q.a2
  let z1 = 0
  let z2 = 0
  let w1 = 0
  let w2 = 0
  const n = buf.length
  for (let i = 0; i < n; i++) {
    const x = buf[i]
    const y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    const u = c0 * y + w1
    w1 = c1 * y - d1 * u + w2
    w2 = c2 * y - d2 * u
    buf[i] = u
  }
}

/** Cascade of sections, in place (pairs of sections are fused). */
export function cascade(buf: Float32Array, sections: Biquad[]): Float32Array {
  let k = 0
  for (; k + 1 < sections.length; k += 2) cascade2(buf, sections[k], sections[k + 1])
  if (k < sections.length) biquad(buf, sections[k])
  return buf
}

/** Zero-phase (forward-backward) filtering, in place. */
export function filtfilt(buf: Float32Array, sections: Biquad[]): Float32Array {
  cascade(buf, sections)
  buf.reverse()
  cascade(buf, sections)
  buf.reverse()
  return buf
}

export function butterworth(type: 'lowpass' | 'highpass', freq: number, sr: number, order: 2 | 4 | 8): Biquad[] {
  const qs = order === 2 ? [Math.SQRT1_2] : order === 4 ? BUTTER4_Q : BUTTER8_Q
  return qs.map((q) => designBiquad(type, freq, sr, q))
}

/** First-order DC blocker (in place). */
export function dcBlock(buf: Float32Array, sr: number, cutoffHz = 5): Float32Array {
  const R = Math.exp((-2 * Math.PI * cutoffHz) / sr)
  let xPrev = 0
  let yPrev = 0
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]
    const y = x - xPrev + R * yPrev
    xPrev = x
    yPrev = y
    buf[i] = y
  }
  return buf
}

/** State for streaming a cascade block by block (2 doubles per section). */
export function cascadeState(sections: Biquad[]): Float64Array {
  return new Float64Array(sections.length * 2)
}

/** Filter `buf` in place, continuing from (and updating) `state`. Used for block streaming. */
export function cascadeStream(buf: Float32Array, sections: Biquad[], state: Float64Array, len = buf.length): void {
  let k = 0
  for (; k + 1 < sections.length; k += 2) {
    const p = sections[k]
    const q = sections[k + 1]
    let z1 = state[2 * k]
    let z2 = state[2 * k + 1]
    let w1 = state[2 * k + 2]
    let w2 = state[2 * k + 3]
    const { b0, b1, b2, a1, a2 } = p
    const c0 = q.b0
    const c1 = q.b1
    const c2 = q.b2
    const d1 = q.a1
    const d2 = q.a2
    for (let i = 0; i < len; i++) {
      const x = buf[i]
      const y = b0 * x + z1
      z1 = b1 * x - a1 * y + z2
      z2 = b2 * x - a2 * y
      const u = c0 * y + w1
      w1 = c1 * y - d1 * u + w2
      w2 = c2 * y - d2 * u
      buf[i] = u
    }
    state[2 * k] = z1
    state[2 * k + 1] = z2
    state[2 * k + 2] = w1
    state[2 * k + 3] = w2
  }
  if (k < sections.length) {
    const { b0, b1, b2, a1, a2 } = sections[k]
    let z1 = state[2 * k]
    let z2 = state[2 * k + 1]
    for (let i = 0; i < len; i++) {
      const x = buf[i]
      const y = b0 * x + z1
      z1 = b1 * x - a1 * y + z2
      z2 = b2 * x - a2 * y
      buf[i] = y
    }
    state[2 * k] = z1
    state[2 * k + 1] = z2
  }
}

/** Block size used by the streaming (low-memory) processors. */
export const STREAM_BLOCK = 4096
