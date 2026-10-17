// Core DSP building blocks: oscillators, filters, reverb, delay, dynamics, loudness.
// Everything is offline (whole-buffer) and allocation-light so it runs fast in a worker.

export const SR = 44100
export const TWO_PI = Math.PI * 2

// ---------------------------------------------------------------- sine table
const TBL_BITS = 12
const TBL = 1 << TBL_BITS
const TBL_MASK = TBL - 1
const SIN = new Float32Array(TBL + 1)
for (let i = 0; i <= TBL; i++) SIN[i] = Math.sin((TWO_PI * i) / TBL)

/** sin(2*pi*phase), phase in cycles (any real). Linear-interpolated table. */
export function sinT(phase: number): number {
  const x = (phase - Math.floor(phase)) * TBL
  const i = x | 0
  const f = x - i
  const a = SIN[i & TBL_MASK]
  return a + (SIN[(i & TBL_MASK) + 1] - a) * f
}

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12)
}
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}
export function gainToDb(g: number): number {
  return 20 * Math.log10(Math.max(1e-12, g))
}
export function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x
}

/** PolyBLEP residual for band-limited discontinuities. t: phase 0..1, dt: phase inc */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt
    return x + x - x * x - 1
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt
    return x * x + x + x + 1
  }
  return 0
}

// ---------------------------------------------------------------- noise
export class Noise {
  private s: number
  constructor(seed: number) {
    this.s = (seed | 0) || 0x1234567
  }
  /** white noise in [-1, 1) */
  next(): number {
    let x = this.s
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.s = x
    return (x | 0) / 2147483648
  }
}

// ---------------------------------------------------------------- filters
/** Cytomic/TPT state variable filter. After process(): lp, bp, hp fields are valid. */
export class Svf {
  private ic1 = 0
  private ic2 = 0
  private a1 = 1
  private a2 = 0
  private a3 = 0
  private k = 1.4
  lp = 0
  bp = 0
  hp = 0
  set(fc: number, q: number): void {
    const f = fc < 10 ? 10 : fc > SR * 0.45 ? SR * 0.45 : fc
    const g = Math.tan((Math.PI * f) / SR)
    this.k = 1 / (q < 0.05 ? 0.05 : q)
    this.a1 = 1 / (1 + g * (g + this.k))
    this.a2 = g * this.a1
    this.a3 = g * this.a2
  }
  process(v0: number): number {
    const v3 = v0 - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    this.lp = v2
    this.bp = v1
    this.hp = v0 - this.k * v1 - v2
    return v2
  }
  reset(): void {
    this.ic1 = this.ic2 = 0
  }
}

/** One-pole lowpass / highpass. */
export class OnePole {
  private a = 0
  private z = 0
  setLp(fc: number): void {
    this.a = Math.exp((-TWO_PI * fc) / SR)
  }
  lp(x: number): number {
    this.z = x + (this.z - x) * this.a
    return this.z
  }
  hp(x: number): number {
    this.z = x + (this.z - x) * this.a
    return x - this.z
  }
  reset(): void {
    this.z = 0
  }
}

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'peak' | 'lowshelf' | 'highshelf'

/** RBJ cookbook biquad (direct form I). */
export class Biquad {
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0
  constructor(type: BiquadType, fc: number, q = 0.707, gainDb = 0) {
    this.set(type, fc, q, gainDb)
  }
  set(type: BiquadType, fc: number, q = 0.707, gainDb = 0): void {
    const w0 = (TWO_PI * clamp(fc, 5, SR * 0.49)) / SR
    const cs = Math.cos(w0)
    const sn = Math.sin(w0)
    const alpha = sn / (2 * q)
    const A = Math.pow(10, gainDb / 40)
    let b0 = 1
    let b1 = 0
    let b2 = 0
    let a0 = 1
    let a1 = 0
    let a2 = 0
    switch (type) {
      case 'lowpass':
        b0 = (1 - cs) / 2
        b1 = 1 - cs
        b2 = (1 - cs) / 2
        a0 = 1 + alpha
        a1 = -2 * cs
        a2 = 1 - alpha
        break
      case 'highpass':
        b0 = (1 + cs) / 2
        b1 = -(1 + cs)
        b2 = (1 + cs) / 2
        a0 = 1 + alpha
        a1 = -2 * cs
        a2 = 1 - alpha
        break
      case 'bandpass':
        b0 = alpha
        b1 = 0
        b2 = -alpha
        a0 = 1 + alpha
        a1 = -2 * cs
        a2 = 1 - alpha
        break
      case 'peak':
        b0 = 1 + alpha * A
        b1 = -2 * cs
        b2 = 1 - alpha * A
        a0 = 1 + alpha / A
        a1 = -2 * cs
        a2 = 1 - alpha / A
        break
      case 'lowshelf': {
        const sq = 2 * Math.sqrt(A) * alpha
        b0 = A * (A + 1 - (A - 1) * cs + sq)
        b1 = 2 * A * (A - 1 - (A + 1) * cs)
        b2 = A * (A + 1 - (A - 1) * cs - sq)
        a0 = A + 1 + (A - 1) * cs + sq
        a1 = -2 * (A - 1 + (A + 1) * cs)
        a2 = A + 1 + (A - 1) * cs - sq
        break
      }
      case 'highshelf': {
        const sq = 2 * Math.sqrt(A) * alpha
        b0 = A * (A + 1 + (A - 1) * cs + sq)
        b1 = -2 * A * (A - 1 + (A + 1) * cs)
        b2 = A * (A + 1 + (A - 1) * cs - sq)
        a0 = A + 1 - (A - 1) * cs + sq
        a1 = 2 * (A - 1 - (A + 1) * cs)
        a2 = A + 1 - (A - 1) * cs - sq
        break
      }
    }
    this.b0 = b0 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
    this.a1 = a1 / a0
    this.a2 = a2 / a0
  }
  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
  /** process a whole buffer in place (range optional) */
  run(buf: Float32Array, from = 0, to = buf.length): void {
    let x1 = this.x1
    let x2 = this.x2
    let y1 = this.y1
    let y2 = this.y2
    const { b0, b1, b2, a1, a2 } = this
    for (let i = from; i < to; i++) {
      const x = buf[i]
      let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      if (y > -1e-20 && y < 1e-20) y = 0
      x2 = x1
      x1 = x
      y2 = y1
      y1 = y
      buf[i] = y
    }
    this.x1 = x1
    this.x2 = x2
    this.y1 = y1
    this.y2 = y2
  }
}

/** Klatt-style two-pole resonator with unity DC gain. */
export class Resonator {
  a = 1
  b = 0
  c = 0
  y1 = 0
  y2 = 0
  set(f: number, bw: number): void {
    const T = 1 / SR
    const r = Math.exp(-Math.PI * bw * T)
    this.c = -r * r
    this.b = 2 * r * Math.cos(TWO_PI * Math.min(f, SR * 0.45) * T)
    this.a = 1 - this.b - this.c
  }
  process(x: number): number {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2
    this.y2 = this.y1
    this.y1 = y
    return y
  }
  /** |H(e^jw)| at frequency f */
  mag(f: number): number {
    const w = (TWO_PI * f) / SR
    const re = 1 - this.b * Math.cos(w) - this.c * Math.cos(2 * w)
    const im = this.b * Math.sin(w) + this.c * Math.sin(2 * w)
    return Math.abs(this.a) / Math.sqrt(re * re + im * im + 1e-18)
  }
}

// ---------------------------------------------------------------- reverb
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
const APS_L = [556, 441, 341, 225]
const APS_R = [579, 464, 364, 248]

export interface ReverbOpts {
  room: number // 0..1
  damp: number // 0..1
  wet: number
  predelayMs: number
  hpHz?: number
  lpHz?: number
  /** scale of comb lengths (0.6 small .. 1.3 large) */
  size?: number
}

/**
 * Freeverb-style reverb: mono send -> stereo wet, added into outL/outR.
 * Shared comb bank, decorrelated allpass chains per side. Skips silent stretches.
 */
export function applyReverb(send: Float32Array, outL: Float32Array, outR: Float32Array, o: ReverbOpts): void {
  const size = o.size ?? 1
  const combLen = COMBS.map((c) => Math.max(50, Math.round(c * size)))
  const combs = combLen.map((n) => new Float32Array(n))
  const combIdx = new Int32Array(8)
  const combStore = new Float64Array(8)
  const apL = APS_L.map((n) => new Float32Array(Math.round(n * size)))
  const apR = APS_R.map((n) => new Float32Array(Math.round(n * size)))
  const apIL = new Int32Array(4)
  const apIR = new Int32Array(4)
  const fb = o.room * 0.28 + 0.7
  const damp1 = o.damp * 0.4
  const damp2 = 1 - damp1
  const pd = Math.round((o.predelayMs / 1000) * SR)
  const hpA = Math.exp((-TWO_PI * (o.hpHz ?? 180)) / SR)
  const lpA = Math.exp((-TWO_PI * (o.lpHz ?? 9000)) / SR)
  let hpZ = 0
  let lpZ = 0
  const n = send.length
  const wet = o.wet * 3
  const BLOCK = 1024
  let quiet = true
  let energy = 0
  for (let b0 = 0; b0 < n; b0 += BLOCK) {
    const b1 = Math.min(n, b0 + BLOCK)
    // check for input in this block (taking predelay into account)
    let hasIn = false
    const s0 = Math.max(0, b0 - pd)
    const s1 = Math.max(0, b1 - pd)
    for (let i = s0; i < s1; i++) {
      if (send[i] !== 0) {
        hasIn = true
        break
      }
    }
    if (!hasIn && quiet) continue
    if (hasIn) quiet = false
    energy = 0
    for (let i = b0; i < b1; i++) {
      const j = i - pd
      const xin = j >= 0 ? send[j] : 0
      // input band-limiting
      hpZ = xin + (hpZ - xin) * hpA
      const h = xin - hpZ
      lpZ = h + (lpZ - h) * lpA
      const x = lpZ * 0.015
      let acc = 0
      for (let c = 0; c < 8; c++) {
        const buf = combs[c]
        const k = combIdx[c]
        const y = buf[k]
        combStore[c] = y * damp2 + combStore[c] * damp1
        buf[k] = x + combStore[c] * fb
        combIdx[c] = k + 1 >= buf.length ? 0 : k + 1
        acc += y
      }
      let l = acc
      let r = acc
      for (let a = 0; a < 4; a++) {
        const bl = apL[a]
        const kl = apIL[a]
        const bo = bl[kl]
        bl[kl] = l + bo * 0.5
        l = bo - l
        apIL[a] = kl + 1 >= bl.length ? 0 : kl + 1
        const br = apR[a]
        const kr = apIR[a]
        const bor = br[kr]
        br[kr] = r + bor * 0.5
        r = bor - r
        apIR[a] = kr + 1 >= br.length ? 0 : kr + 1
      }
      outL[i] += l * wet
      outR[i] += r * wet
      energy += l * l + r * r
    }
    if (!hasIn && energy < 1e-9) {
      quiet = true
      for (const c of combs) c.fill(0)
      for (const a of apL) a.fill(0)
      for (const a of apR) a.fill(0)
      combStore.fill(0)
      hpZ = lpZ = 0
    }
  }
}

/** Tempo-synced ping-pong delay from a mono send. */
export function applyDelay(
  send: Float32Array,
  outL: Float32Array,
  outR: Float32Array,
  delaySec: number,
  feedback: number,
  wet: number,
  lpHz = 4500,
): void {
  const D = Math.max(1, Math.round(delaySec * SR))
  const bl = new Float32Array(D)
  const br = new Float32Array(D)
  let k = 0
  const a = Math.exp((-TWO_PI * lpHz) / SR)
  const hpA = Math.exp((-TWO_PI * 250) / SR)
  let zl = 0
  let zr = 0
  let hz = 0
  const n = send.length
  let silentRun = 0
  for (let i = 0; i < n; i++) {
    const xin = send[i]
    if (xin === 0) {
      silentRun++
      if (silentRun > D * 12) {
        // fully decayed: jump ahead to the next input
        let j = i
        while (j < n && send[j] === 0) j++
        if (j >= n) break
        bl.fill(0)
        br.fill(0)
        zl = zr = hz = 0
        i = j - 1
        silentRun = 0
        continue
      }
    } else silentRun = 0
    hz = xin + (hz - xin) * hpA
    const x = xin - hz
    const yl = bl[k]
    const yr = br[k]
    zl = yr + (zl - yr) * a
    zr = yl + (zr - yl) * a
    bl[k] = x + zl * feedback
    br[k] = zr * feedback
    k = k + 1 >= D ? 0 : k + 1
    outL[i] += yl * wet
    outR[i] += yr * wet
  }
}

// ---------------------------------------------------------------- dynamics
export interface CompOpts {
  threshDb: number
  ratio: number
  attackMs: number
  releaseMs: number
  kneeDb?: number
  makeupDb?: number
}

/** Stereo-linked feed-forward compressor, in place. Returns average gain reduction dB. */
export function compress(L: Float32Array, R: Float32Array, o: CompOpts, from = 0, to = L.length): number {
  const att = Math.exp(-1 / ((o.attackMs / 1000) * SR))
  const rel = Math.exp(-1 / ((o.releaseMs / 1000) * SR))
  const knee = o.kneeDb ?? 6
  const makeup = dbToGain(o.makeupDb ?? 0)
  let env = 0
  let g = 1
  let gTarget = 1
  let grSum = 0
  let grN = 0
  const CR = 16
  for (let i = from; i < to; i++) {
    const l = L[i]
    const r = R[i]
    const lvl = Math.max(l < 0 ? -l : l, r < 0 ? -r : r)
    env = lvl > env ? lvl + (env - lvl) * att : lvl + (env - lvl) * rel
    if ((i & (CR - 1)) === 0) {
      const db = gainToDb(env)
      const over = db - o.threshDb
      let red = 0
      if (over > knee / 2) red = over * (1 - 1 / o.ratio)
      else if (over > -knee / 2) {
        const x = over + knee / 2
        red = ((1 - 1 / o.ratio) * x * x) / (2 * knee)
      }
      gTarget = dbToGain(-red)
      grSum += red
      grN++
    }
    g += (gTarget - g) * 0.02
    const m = g * makeup
    L[i] = l * m
    R[i] = r * m
  }
  return grN ? grSum / grN : 0
}

/** BS.1770 integrated loudness (LUFS), with absolute & relative gating. */
export function measureLufs(L: Float32Array, R: Float32Array): number {
  const n = L.length
  const hs1 = new Biquad('highshelf', 1681.97, 0.7072, 4.0)
  const hp1 = new Biquad('highpass', 38.13, 0.5003)
  const hs2 = new Biquad('highshelf', 1681.97, 0.7072, 4.0)
  const hp2 = new Biquad('highpass', 38.13, 0.5003)
  const sub = Math.round(SR * 0.1)
  const subs: number[] = []
  let acc = 0
  let cnt = 0
  for (let i = 0; i < n; i++) {
    const l = hp1.process(hs1.process(L[i]))
    const r = hp2.process(hs2.process(R[i]))
    acc += l * l + r * r
    if (++cnt === sub) {
      subs.push(acc / sub)
      acc = 0
      cnt = 0
    }
  }
  const blocks: number[] = []
  for (let i = 0; i + 4 <= subs.length; i++) blocks.push((subs[i] + subs[i + 1] + subs[i + 2] + subs[i + 3]) / 4)
  if (!blocks.length) return -70
  const lk = (ms: number) => -0.691 + 10 * Math.log10(Math.max(1e-12, ms))
  const abs = blocks.filter((b) => lk(b) > -70)
  if (!abs.length) return -70
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length
  const relGate = lk(meanAbs) - 10
  const rel = abs.filter((b) => lk(b) > relGate)
  const m = rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length)
  return lk(m)
}

/**
 * Offline look-ahead peak limiter, in place. Guarantees |x| <= ceiling
 * (followed by a final hard safety clamp).
 */
export function limit(L: Float32Array, R: Float32Array, ceiling: number, lookMs = 4, releaseMs = 120): void {
  const n = L.length
  const La = Math.max(1, Math.round((lookMs / 1000) * SR))
  const target = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(L[i]), Math.abs(R[i]))
    target[i] = p > ceiling ? ceiling / p : 1
  }
  // look-ahead sliding minimum: m[j] = min(target[j..j+La])
  const m = new Float32Array(n)
  const dq = new Int32Array(n + 1)
  let h = 0
  let t = 0
  let next = 0
  for (let j = 0; j < n; j++) {
    const hi = Math.min(n - 1, j + La)
    while (next <= hi) {
      const v = target[next]
      while (t > h && target[dq[t - 1]] >= v) t--
      dq[t++] = next
      next++
    }
    while (dq[h] < j) h++
    m[j] = target[dq[h]]
  }
  // moving average over [i-La, i]  (<= target[i] guaranteed), then release smoothing
  const rel = Math.exp(-1 / ((releaseMs / 1000) * SR))
  let sum = 0
  let g = 1
  for (let i = 0; i < n; i++) {
    sum += m[i]
    if (i - La - 1 >= 0) sum -= m[i - La - 1]
    const cntWin = Math.min(i + 1, La + 1)
    // pad with 1s before the start
    const avg = (sum + (La + 1 - cntWin)) / (La + 1)
    const ga = avg
    g = ga < g ? ga : ga + (g - ga) * rel
    let l = L[i] * g
    let r = R[i] * g
    if (l > ceiling) l = ceiling
    else if (l < -ceiling) l = -ceiling
    if (r > ceiling) r = ceiling
    else if (r < -ceiling) r = -ceiling
    L[i] = l
    R[i] = r
  }
}

export function peakOf(...bufs: Float32Array[]): number {
  let p = 0
  for (const b of bufs) for (let i = 0; i < b.length; i++) {
    const v = b[i] < 0 ? -b[i] : b[i]
    if (v > p) p = v
  }
  return p
}

export function scale(buf: Float32Array, g: number): void {
  for (let i = 0; i < buf.length; i++) buf[i] *= g
}

/** smoothstep 0..1 */
export function smooth(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return x * x * (3 - 2 * x)
}
