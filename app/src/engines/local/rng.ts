// Deterministic seeded randomness helpers.

export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Combine numbers/strings into a well-mixed 32-bit seed. */
export function mixSeed(...parts: Array<number | string>): number {
  let h = 0x9e3779b9 | 0
  for (const p of parts) {
    let v: number
    if (typeof p === 'number') {
      const n = Number.isFinite(p) ? p : 0
      v = (n | 0) ^ (Math.floor(n / 4294967296) | 0)
    } else v = hashString(p)
    h = Math.imul(h ^ v, 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    h ^= h >>> 16
  }
  return h >>> 0
}

export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = (mixSeed(seed) ^ 0x6d2b79f5) | 0
  }
  /** uniform [0,1) (mulberry32) */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next()
  }
  /** integer in [a, b] inclusive */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1))
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length]
  }
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let tot = 0
    for (const w of weights) tot += Math.max(0, w)
    let r = this.next() * tot
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i])
      if (r <= 0) return items[i]
    }
    return items[items.length - 1]
  }
  gauss(): number {
    const u = Math.max(1e-9, this.next())
    const v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const t = arr[i]
      arr[i] = arr[j]
      arr[j] = t
    }
    return arr
  }
  fork(tag: string | number): Rng {
    return new Rng(mixSeed(this.s, tag))
  }
}
