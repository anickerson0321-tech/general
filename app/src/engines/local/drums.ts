// Drum kits (synthesised one-shots, pre-rendered per song) and genre groove patterns.
import { Biquad, Noise, OnePole, SR, sinT } from './dsp'
import { softclip } from './instruments'
import type { Bus } from './instruments'
import type { DrumKit } from './style'
import type { Rng } from './rng'

export type DrumInst = 'k' | 's' | 'clap' | 'rim' | 'ch' | 'oh' | 'hp' | 'crash' | 'ride' | 'th' | 'tm' | 'tl' | 'shaker' | 'tamb' | 'snap' | 'taiko' | 'brush'

export interface DrumHit {
  t: number
  inst: DrumInst
  vel: number
}

type Kit = Record<DrumInst, Float32Array[]>

function buf(sec: number): Float32Array {
  return new Float32Array(Math.ceil(sec * SR))
}

function metallic(out: Float32Array, base: number, seed: number, decay: number, hpHz: number, amp: number, noiseMix: number): void {
  const ratios = [1, 1.483, 1.932, 2.546, 2.63, 3.897]
  const ph = new Float64Array(6)
  const nz = new Noise(seed)
  const hp1 = new Biquad('highpass', hpHz, 0.7)
  const hp2 = new Biquad('highpass', hpHz, 0.7)
  const pk = new Biquad('peak', 10000, 0.8, 4)
  for (let i = 0; i < out.length; i++) {
    let s = 0
    for (let k = 0; k < 6; k++) {
      ph[k] += (base * ratios[k]) / SR
      s += ph[k] - Math.floor(ph[k]) < 0.5 ? 1 : -1
    }
    s = s / 6 + nz.next() * noiseMix
    const env = Math.exp(-i / (decay * SR)) * Math.min(1, i / 8)
    out[i] = pk.process(hp2.process(hp1.process(s))) * env * amp
  }
}

function kick(kit: DrumKit, seed: number, v: number): Float32Array {
  const cfg = {
    acoustic: { f0: 105, f1: 52, pd: 0.035, dec: 0.3, click: 0.35, drive: 1.6, sec: 0.6 },
    electronic: { f0: 170, f1: 50, pd: 0.03, dec: 0.38, click: 0.25, drive: 2.0, sec: 0.7 },
    '808': { f0: 120, f1: 44, pd: 0.03, dec: 0.55, click: 0.2, drive: 1.8, sec: 0.9 },
    lofi: { f0: 95, f1: 50, pd: 0.03, dec: 0.25, click: 0.15, drive: 1.4, sec: 0.5 },
    brush: { f0: 85, f1: 50, pd: 0.03, dec: 0.22, click: 0.05, drive: 1.1, sec: 0.45 },
    epic: { f0: 90, f1: 46, pd: 0.05, dec: 0.5, click: 0.2, drive: 1.8, sec: 0.9 },
    synthwave: { f0: 140, f1: 48, pd: 0.03, dec: 0.32, click: 0.3, drive: 2.2, sec: 0.6 },
  }[kit]
  const out = buf(cfg.sec)
  const nz = new Noise(seed)
  const lp = new OnePole()
  lp.setLp(kit === 'lofi' ? 2000 : 4500)
  let ph = 0
  const f0 = cfg.f0 * (1 + (v - 0.5) * 0.04)
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    const f = cfg.f1 + (f0 - cfg.f1) * Math.exp(-t / cfg.pd)
    ph += f / SR
    const env = Math.exp(-t / cfg.dec) * Math.min(1, i / 20)
    let s = softclip(sinT(ph) * env * cfg.drive)
    s += lp.lp(nz.next()) * cfg.click * Math.exp(-t / 0.004)
    out[i] = s * 0.9
  }
  // fade tail
  const fl = Math.round(0.03 * SR)
  for (let i = 0; i < fl; i++) out[out.length - 1 - i] *= i / fl
  return out
}

function snare(kit: DrumKit, seed: number): Float32Array {
  const out = buf(kit === 'synthwave' ? 0.5 : 0.4)
  const nz = new Noise(seed)
  const hp = new Biquad('highpass', kit === 'lofi' ? 900 : 1400, 0.7)
  const bp = new Biquad('peak', 5000, 0.8, 4)
  const lp = new Biquad('lowpass', kit === 'lofi' ? 5500 : 11000, 0.7)
  let p1 = 0
  let p2 = 0
  const ndec = kit === 'synthwave' ? 0.22 : kit === 'electronic' || kit === '808' ? 0.13 : 0.16
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    const fdrop = 1 + 0.25 * Math.exp(-t / 0.01)
    p1 += (185 * fdrop) / SR
    p2 += (330 * fdrop) / SR
    const tone = sinT(p1) * Math.exp(-t / 0.07) * 0.55 + sinT(p2) * Math.exp(-t / 0.04) * 0.3
    const noise = lp.process(bp.process(hp.process(nz.next()))) * Math.exp(-t / ndec) * 0.75
    out[i] = softclip((tone + noise) * 1.3) * Math.min(1, i / 10)
  }
  return out
}

function clap(seed: number): Float32Array {
  const out = buf(0.35)
  const nz = new Noise(seed)
  const bp = new Biquad('bandpass', 1200, 1.1)
  const hp = new Biquad('highpass', 700, 0.7)
  const bursts = [0, 0.011, 0.022, 0.034]
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    let env = 0
    for (const b of bursts) if (t >= b && t < b + 0.012) env = Math.max(env, Math.exp(-(t - b) / 0.004))
    if (t >= 0.034) env = Math.max(env, Math.exp(-(t - 0.034) / 0.11))
    out[i] = hp.process(bp.process(nz.next())) * env * 2.2
  }
  return out
}

function tom(f: number, seed: number): Float32Array {
  const out = buf(0.6)
  const nz = new Noise(seed)
  const lp = new OnePole()
  lp.setLp(3000)
  let ph = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    ph += (f * (0.75 + 0.35 * Math.exp(-t / 0.08))) / SR
    out[i] = (softclip(sinT(ph) * 1.5) * Math.exp(-t / 0.3) + lp.lp(nz.next()) * 0.25 * Math.exp(-t / 0.03)) * 0.8
  }
  return out
}

function noiseHit(sec: number, seed: number, fc: number, q: number, att: number, dec: number, amp: number): Float32Array {
  const out = buf(sec)
  const nz = new Noise(seed)
  const bp = new Biquad('bandpass', fc, q)
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    const env = Math.min(1, t / att) * Math.exp(-Math.max(0, t - att) / dec)
    out[i] = bp.process(nz.next()) * env * amp
  }
  return out
}

function rim(seed: number): Float32Array {
  const out = buf(0.08)
  const nz = new Noise(seed)
  let p1 = 0
  let p2 = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    p1 += 1700 / SR
    p2 += 480 / SR
    out[i] = (sinT(p1) * 0.5 + sinT(p2) * 0.4 + nz.next() * 0.3 * Math.exp(-t / 0.002)) * Math.exp(-t / 0.012)
  }
  return out
}

function taiko(seed: number): Float32Array {
  const out = buf(1.4)
  const nz = new Noise(seed)
  const lp = new OnePole()
  lp.setLp(600)
  let ph = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    ph += (62 + 30 * Math.exp(-t / 0.06)) / SR
    out[i] = softclip((sinT(ph) * Math.exp(-t / 0.5) + lp.lp(nz.next()) * 0.8 * Math.exp(-t / 0.08)) * 1.6) * 0.9
  }
  return out
}

/** Pre-render a kit (2 round-robin variants per piece). */
export function buildKit(kit: DrumKit, seed: number): Kit {
  const k: Partial<Kit> = {}
  const two = (fn: (s: number) => Float32Array) => [fn(seed + 1), fn(seed + 2)]
  k.k = [kick(kit, seed + 3, 0.4), kick(kit, seed + 4, 0.6)]
  k.s = kit === 'brush' ? two((s) => noiseHit(0.35, s, 3500, 0.6, 0.012, 0.12, 1.1)) : two((s) => snare(kit, s))
  k.clap = two(clap)
  k.rim = two(rim)
  const hatBase = kit === 'lofi' ? 330 : 400
  const lofiLp = kit === 'lofi' || kit === 'brush'
  k.ch = two((s) => {
    const b = buf(0.12)
    metallic(b, hatBase, s, kit === '808' ? 0.035 : 0.045, 7000, 0.6, 0.5)
    if (lofiLp) new Biquad('lowpass', 7000, 0.7).run(b)
    return b
  })
  k.oh = two((s) => {
    const b = buf(0.6)
    metallic(b, hatBase, s, 0.28, 6500, 0.5, 0.5)
    if (lofiLp) new Biquad('lowpass', 7000, 0.7).run(b)
    return b
  })
  k.hp = two((s) => {
    const b = buf(0.08)
    metallic(b, hatBase, s, 0.02, 7500, 0.35, 0.4)
    return b
  })
  k.crash = two((s) => {
    const b = buf(2.2)
    metallic(b, 520, s, 1.1, 4000, 0.55, 1.2)
    return b
  })
  k.ride = two((s) => {
    const b = buf(1.2)
    metallic(b, 610, s, 0.6, 3500, 0.3, 0.6)
    // bell
    let p = 0
    for (let i = 0; i < b.length; i++) {
      p += 2550 / SR
      b[i] += sinT(p) * 0.08 * Math.exp(-i / (0.4 * SR))
    }
    return b
  })
  k.th = [tom(210, seed + 5)]
  k.tm = [tom(155, seed + 6)]
  k.tl = [tom(108, seed + 7)]
  k.shaker = two((s) => noiseHit(0.12, s, 7000, 1.2, 0.012, 0.035, 0.9))
  k.tamb = two((s) => {
    const b = buf(0.3)
    metallic(b, 1800, s, 0.12, 6000, 0.4, 1.0)
    return b
  })
  k.snap = two((s) => noiseHit(0.1, s, 2200, 2.5, 0.001, 0.025, 2.2))
  k.taiko = [taiko(seed + 8), taiko(seed + 9)]
  k.brush = two((s) => noiseHit(0.3, s, 4000, 0.5, 0.03, 0.1, 0.6))
  return k as Kit
}

// ------------------------------------------------------------------- mixing table
const PAN: Record<DrumInst, number> = {
  k: 0, s: 0, clap: 0.05, rim: 0.1, ch: 0.3, oh: 0.3, hp: 0.3, crash: -0.45, ride: 0.45, th: -0.35, tm: 0.05, tl: 0.4,
  shaker: 0.5, tamb: -0.5, snap: -0.1, taiko: 0, brush: 0.1,
}
const GAIN: Record<DrumInst, number> = {
  k: 1, s: 0.7, clap: 0.55, rim: 0.4, ch: 0.28, oh: 0.25, hp: 0.25, crash: 0.32, ride: 0.3, th: 0.6, tm: 0.6, tl: 0.65,
  shaker: 0.22, tamb: 0.22, snap: 0.5, taiko: 0.9, brush: 0.5,
}
const REV: Record<DrumInst, number> = {
  k: 0.02, s: 0.16, clap: 0.2, rim: 0.12, ch: 0.03, oh: 0.06, hp: 0.02, crash: 0.12, ride: 0.06, th: 0.18, tm: 0.18, tl: 0.18,
  shaker: 0.08, tamb: 0.1, snap: 0.2, taiko: 0.35, brush: 0.15,
}

export function renderDrums(bus: Bus, kit: Kit, hits: DrumHit[], gain: number, snareRev: number, r: Rng): void {
  let rr = 0
  for (const h of hits) {
    const v = kit[h.inst]
    const smp = v[rr++ % v.length]
    const pan = PAN[h.inst]
    const g = GAIN[h.inst] * h.vel * gain
    const rev = h.inst === 's' || h.inst === 'clap' ? REV[h.inst] * snareRev : REV[h.inst]
    bus.add(smp, smp.length, Math.round(h.t * SR), g, pan, rev, 0, false, h.inst === 'k' ? 'kick' : h.inst === 's' || h.inst === 'clap' ? 'snare' : 'perc')
  }
  void r
}

// ------------------------------------------------------------------- patterns
export type DrumStyle =
  | 'pop' | 'dance' | 'house' | 'rock' | 'punk' | 'metal' | 'boombap' | 'trap' | 'rnb' | 'synthwave' | 'lofi'
  | 'country' | 'folk' | 'jazz' | 'ballad' | 'onedrop' | 'dembow' | 'gospel' | 'epic'

type Pat = Partial<Record<DrumInst, string>>

const P: Record<DrumStyle, [Pat, Pat, Pat]> = {
  pop: [
    { k: 'x.......x.......', rim: '....x.......x...', ch: 'o.o.o.o.o.o.o.o.' },
    { k: 'x.....x.x.......', s: '....x.......x...', clap: '....o.......o...', ch: 'x.xox.xox.xox.xo' },
    { k: 'x.....x.x.x.....', s: '....X.......X...', clap: '....x.......x...', ch: 'xoxoxoxoxoxoxoxo', oh: '..............x.', tamb: '....o.......o...' },
  ],
  dance: [
    { k: 'x...x...x...x...', ch: '..x...x...x...x.' },
    { k: 'x...x...x...x...', clap: '....x.......x...', ch: 'x.x.x.x.x.x.x.x.', oh: '..o...o...o...o.' },
    { k: 'x...x...x...x..o', clap: '....X.......X...', s: '....o.......o...', ch: 'xxxxxxxxxxxxxxxx', oh: '..x...x...x...x.' },
  ],
  house: [
    { k: 'x...x...x...x...', ch: '..o...o...o...o.' },
    { k: 'x...x...x...x...', clap: '....x.......x...', oh: '..x...x...x...x.', ch: 'o.o.o.o.o.o.o.o.' },
    { k: 'x...x...x...x...', clap: '....X.......X...', oh: '..x...x...x...x.', ch: 'gogogogogogogogo', shaker: 'xoxoxoxoxoxoxoxo' },
  ],
  rock: [
    { k: 'x.......x.......', s: '....o.......o...', ch: 'x.x.x.x.x.x.x.x.' },
    { k: 'x......xx.x.....', s: '....x.......x...', ch: 'x.x.x.x.x.x.x.x.' },
    { k: 'x.x....xx.x...x.', s: '....X.......X...', ride: 'x.x.x.x.x.x.x.x.', oh: 'x...............' },
  ],
  punk: [
    { k: 'x.......x.......', s: '....x.......x...', ch: 'x.x.x.x.x.x.x.x.' },
    { k: 'x...x...x...x...', s: '..x...x...x...x.', ch: 'x.x.x.x.x.x.x.x.' },
    { k: 'x...x...x...x...', s: '..X...X...X...X.', ride: 'x.x.x.x.x.x.x.x.' },
  ],
  metal: [
    { k: 'x.......x.......', s: '....x.......x...', ch: 'x.x.x.x.x.x.x.x.' },
    { k: 'x.x.x.x.x.x.x.x.', s: '....x.......x...', ch: 'x.x.x.x.x.x.x.x.' },
    { k: 'xxxxxxxxxxxxxxxx', s: '....X.......X...', ride: 'x...x...x...x...' },
  ],
  boombap: [
    { k: 'x.........x.....', ch: 'x.x.x.x.x.x.x.x.' },
    { k: 'x......x..x.....', s: '....x.......x...', ch: 'x.xox.xox.xox.xo' },
    { k: 'x......x..x..x..', s: '....X.......X...', ch: 'x.xox.xox.xox.xo', oh: '..............o.' },
  ],
  trap: [
    { k: 'x.........x.....', ch: 'x.x.x.x.x.x.x.x.' },
    { k: 'x.....x...x.....', clap: '........x.......', ch: 'x.x.x.x.x.x.x.x.' },
    { k: 'x.....x..x.x....', clap: '........X.......', s: '........o.......', ch: 'xoxoxoxoxoxoxoxo', oh: '..............o.' },
  ],
  rnb: [
    { k: 'x.......x.......', snap: '....x.......x...', ch: 'o.o.o.o.o.o.o.o.' },
    { k: 'x......x..x.....', s: '....x.......x...', snap: '....o.......o...', ch: 'x.xox.xox.xox.xo' },
    { k: 'x..x...x..x.....', s: '....X.......X...', clap: '....o.......o...', ch: 'xoxoxoxoxoxoxoxo', oh: '..............o.' },
  ],
  synthwave: [
    { k: 'x.......x.......', ch: 'o.o.o.o.o.o.o.o.' },
    { k: 'x...x...x...x...', s: '....x.......x...', ch: 'x.x.x.x.x.x.x.x.' },
    { k: 'x...x...x...x...', s: '....X.......X...', clap: '....o.......o...', ch: 'xoxoxoxoxoxoxoxo', oh: '..o...o...o...o.' },
  ],
  lofi: [
    { k: 'x.......x.......', rim: '....x.......x...', ch: 'o.o.o.o.o.o.o.o.' },
    { k: 'x......x..x.....', s: '....x.......x...', ch: 'x.gox.gox.gox.go' },
    { k: 'x......x..x..o..', s: '....x.......x..g', ch: 'x.gox.gox.gox.go', shaker: '..o...o...o...o.' },
  ],
  country: [
    { k: 'x.......x.......', rim: '....x.......x...', shaker: 'xoxoxoxoxoxoxoxo' },
    { k: 'x.......x.......', s: '....x.......x...', ch: 'x.x.x.x.x.x.x.x.' },
    { k: 'x.....x.x.......', s: '....X.......X...', ch: 'xoxoxoxoxoxoxoxo', tamb: '....o.......o...' },
  ],
  folk: [
    { k: 'o.......o.......', shaker: 'o.o.o.o.o.o.o.o.' },
    { k: 'x.......x.......', tamb: '....o.......o...', shaker: 'xoxoxoxoxoxoxoxo' },
    { k: 'x.....x.x.......', s: '....x.......x...', tamb: '....o.......o...', ch: 'x.x.x.x.x.x.x.x.' },
  ],
  jazz: [
    { ride: 'x...x.ox...x.o..', hp: '....x.......x...' },
    { ride: 'x...x.ox...x.ox.', hp: '....x.......x...', k: 'g.......g.......', brush: '......g.......g.' },
    { ride: 'x...x.xx...x.xx.', hp: '....x.......x...', k: 'o.....g...o.....', s: '......o...g...o.' },
  ],
  ballad: [
    { k: 'o.......o.......', rim: '....o.......o...', ch: 'o.o.o.o.o.o.o.o.' },
    { k: 'x.......x.......', rim: '....x.......x...', ch: 'x.x.x.x.x.x.x.x.' },
    { k: 'x......xx.......', s: '....X.......X...', ch: 'x.x.x.x.x.x.x.x.' },
  ],
  onedrop: [
    { rim: '........x.......', ch: 'x.o.x.o.x.o.x.o.' },
    { k: '........x.......', rim: '........x.......', ch: 'x.o.x.o.x.o.x.o.' },
    { k: 'x...x...x...x...', s: '........x.......', rim: '....o.......o...', ch: 'xoxoxoxoxoxoxoxo' },
  ],
  dembow: [
    { k: 'x...x...x...x...', ch: 'x.x.x.x.x.x.x.x.' },
    { k: 'x...x...x...x...', s: '...x..x....x..x.', ch: 'x.x.x.x.x.x.x.x.' },
    { k: 'x...x...x...x...', s: '...X..x....X..x.', clap: '...o..o....o..o.', ch: 'xoxoxoxoxoxoxoxo', shaker: 'o.o.o.o.o.o.o.o.' },
  ],
  gospel: [
    { k: 'x.......x.......', ch: 'o.o.o.o.o.o.o.o.' },
    { k: 'x.....x.x.......', s: '....x.......x...', clap: '....o.......o...', ch: 'x.xox.xox.xox.xo' },
    { k: 'x.....x.x..x....', s: '....X.......X...', clap: '....x.......x...', ch: 'xoxoxoxoxoxoxoxo', tamb: '..o...o...o...o.' },
  ],
  epic: [
    { taiko: 'x...............', tl: '........o.......' },
    { taiko: 'x.....x.x.......', tl: '....o.......o...', tm: '..............o.' },
    { taiko: 'x.....x.x...x.x.', s: '....x.......x...', tl: '..o...o...o...o.', crash: '' },
  ],
}

const VEL: Record<string, number> = { X: 1, x: 0.82, o: 0.55, g: 0.3 }

export function drumStyleFor(genre: string, kit: DrumKit): DrumStyle {
  switch (genre) {
    case 'kpop':
      return 'dance'
    case 'edm':
      return 'house'
    case 'hiphop':
      return 'boombap'
    case 'reggae':
      return 'onedrop'
    case 'latin':
      return 'dembow'
    case 'cinematic':
      return kit === 'epic' ? 'epic' : 'ballad'
    case 'pop':
    case 'rock':
    case 'punk':
    case 'metal':
    case 'trap':
    case 'rnb':
    case 'synthwave':
    case 'lofi':
    case 'country':
    case 'folk':
    case 'jazz':
    case 'ballad':
    case 'gospel':
      return genre
    default:
      return 'pop'
  }
}

export interface BarCtx {
  style: DrumStyle
  level: 0 | 1 | 2
  /** absolute 16th of bar start */
  bar16: number
  barInSection: number
  barsInSection: number
  /** fill at the end of this bar */
  fill: 'none' | 'toms' | 'snare' | 'build' | 'stop'
  crash: boolean
  r: Rng
  humanize: number
  weird: number
}

/** Hits for one bar as (pos16 fractional, inst, vel). */
export function barHits(c: BarCtx): Array<{ p: number; inst: DrumInst; vel: number }> {
  const out: Array<{ p: number; inst: DrumInst; vel: number }> = []
  const pat = P[c.style][c.level]
  const fillStart = c.fill === 'none' || c.fill === 'stop' ? 16 : c.fill === 'build' ? 0 : c.r.chance(0.5) ? 12 : 8
  for (const [inst, str] of Object.entries(pat) as Array<[DrumInst, string]>) {
    if (!str) continue
    for (let i = 0; i < 16; i++) {
      const ch = str[i]
      if (ch === '.' || ch === undefined) continue
      if (i >= fillStart && c.fill !== 'build' && (inst === 's' || inst === 'k' || inst === 'clap' || inst === 'ch' || inst === 'oh' || inst === 'ride')) {
        if (inst === 'k' && i === fillStart) {
          // keep the kick at the start of the fill
        } else continue
      }
      if (c.fill === 'stop' && i >= 12) continue
      let vel = VEL[ch] ?? 0.8
      vel *= 1 + (c.r.next() - 0.5) * 0.16
      out.push({ p: i, inst, vel })
    }
  }
  // variations: occasional ghost / extra kick on the last bar of 4
  if (c.level >= 1 && c.barInSection % 4 === 3 && c.fill === 'none') {
    if (c.r.chance(0.5)) out.push({ p: 14, inst: 'k', vel: 0.6 })
    if (c.r.chance(0.3 + c.weird * 0.3) && c.style !== 'jazz') out.push({ p: 15, inst: c.style === 'trap' ? 'ch' : 's', vel: 0.3 })
  }
  if (c.weird > 0.6 && c.r.chance(c.weird * 0.4)) out.push({ p: c.r.pick([3, 7, 11, 13]), inst: 'k', vel: 0.55 })
  // trap hat rolls
  if (c.style === 'trap' && c.level >= 1) {
    for (let beat = 0; beat < 4; beat++) {
      if (c.r.chance(0.28)) {
        const kind = c.r.pick([3, 4, 6])
        const startQ = beat * 4 + (c.r.chance(0.5) ? 2 : 0)
        // remove existing hats in that half-beat
        for (let k = out.length - 1; k >= 0; k--) if (out[k].inst === 'ch' && out[k].p >= startQ && out[k].p < startQ + 2) out.splice(k, 1)
        for (let k = 0; k < kind; k++) out.push({ p: startQ + (k * 2) / kind, inst: 'ch', vel: 0.45 + (k / kind) * 0.4 })
      }
    }
  }
  // fills
  if (c.fill === 'toms') {
    const toms: DrumInst[] = ['th', 'th', 'tm', 'tm', 'tl', 'tl', 'tl', 'tl']
    for (let i = fillStart, k = 0; i < 16; i++, k++) {
      const inst = c.r.chance(0.25) ? 's' : toms[Math.min(toms.length - 1, Math.floor((k / (16 - fillStart)) * toms.length))]
      out.push({ p: i, inst, vel: 0.6 + (k / (16 - fillStart)) * 0.4 })
    }
  } else if (c.fill === 'snare') {
    for (let i = fillStart; i < 16; i++) out.push({ p: i, inst: c.style === 'trap' || c.style === 'house' || c.style === 'dance' ? 'clap' : 's', vel: 0.45 + ((i - fillStart) / (16 - fillStart)) * 0.55 })
  } else if (c.fill === 'build') {
    // snare roll accelerating over the bar: 8ths, then 16ths, then 32nds in the last beat
    for (let i = 0; i < 16; i++) {
      if (i < 8 && i % 2 === 1) continue
      out.push({ p: i, inst: c.style === 'house' || c.style === 'dance' || c.style === 'trap' ? 'clap' : 's', vel: 0.35 + (i / 16) * 0.6 })
      if (i >= 12) out.push({ p: i + 0.5, inst: 's', vel: 0.4 + (i / 16) * 0.5 })
    }
  }
  if (c.crash) out.push({ p: 0, inst: c.style === 'epic' ? 'taiko' : 'crash', vel: 0.9 })
  return out
}
