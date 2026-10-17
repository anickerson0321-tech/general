// Mixing and mastering: send effects, vocal chain, bus compression, loudness normalisation, limiting.
import type { StereoBuffer } from '../../types'
import { Biquad, SR, applyDelay, applyReverb, compress, dbToGain, limit, measureLufs } from './dsp'
import { softclip } from './instruments'
import type { Bus } from './instruments'
import type { SongPlan } from './model'

export const TARGET_LUFS = -14
export const CEILING = 0.881 // -1.1 dBFS

function rms(L: Float32Array, R: Float32Array, from = 0, to = L.length): number {
  let s = 0
  let n = 0
  for (let i = from; i < to; i += 4) {
    s += L[i] * L[i] + R[i] * R[i]
    n += 2
  }
  return Math.sqrt(s / Math.max(1, n))
}

/** RMS over the regions where `mask` is non-zero (sampled every 64). */
function maskedRms(L: Float32Array, R: Float32Array, mask: Float32Array): number {
  let s = 0
  let n = 0
  for (let i = 0; i < L.length; i += 16) {
    if (mask[i] === 0 && mask[Math.min(mask.length - 1, i + 8)] === 0) continue
    s += L[i] * L[i] + R[i] * R[i]
    n += 2
  }
  return Math.sqrt(s / Math.max(1, n))
}

function eqStereo(L: Float32Array, R: Float32Array, filters: Array<() => Biquad>): void {
  for (const mk of filters) {
    mk().run(L)
    mk().run(R)
  }
}

/** Apply the instrument bus effects (reverb, delay, tone) in place. */
export function processInstrumental(bus: Bus, plan: SongPlan): void {
  const p = plan.profile
  const g = p.genre
  const size = g === 'cinematic' || g === 'synthwave' ? 1.25 : g === 'lofi' || g === 'hiphop' ? 0.8 : g === 'punk' || g === 'metal' ? 0.85 : 1
  applyReverb(bus.rev, bus.L, bus.R, { room: 0.62 + p.reverb * 0.32, damp: g === 'lofi' ? 0.7 : 0.45, wet: 1, predelayMs: 18, size, hpHz: 220, lpHz: g === 'lofi' ? 5000 : 8500 })
  const dsec = plan.spb * (g === 'synthwave' || g === 'edm' || g === 'kpop' ? 0.75 : 0.5)
  applyDelay(bus.dly, bus.L, bus.R, dsec, 0.38, 0.55, g === 'lofi' ? 2500 : 4500)
  const filters: Array<() => Biquad> = [() => new Biquad('highpass', 28, 0.7), () => new Biquad('peak', 320, 0.8, -1.5)]
  if (g === 'lofi' || p.instruments.vinyl) filters.push(() => new Biquad('lowpass', 7200, 0.6))
  else filters.push(() => new Biquad('highshelf', 9000, 0.7, 1 + p.brightness * 1.5))
  eqStereo(bus.L, bus.R, filters)
  if (g === 'lofi') {
    for (let i = 0; i < bus.n; i++) {
      bus.L[i] = softclip(bus.L[i] * 1.2) / 1.1
      bus.R[i] = softclip(bus.R[i] * 1.2) / 1.1
    }
  }
}

/** Vocal chain: EQ, compression, plate reverb, slap/echo delay. In place. */
export function processVocals(bus: Bus, plan: SongPlan): void {
  const fem = plan.gender === 'female'
  // pre-normalise so the compressor threshold is meaningful
  const r0 = rms(bus.L, bus.R)
  if (r0 > 0) {
    const k = 0.1 / r0
    for (let i = 0; i < bus.n; i++) {
      bus.L[i] *= k
      bus.R[i] *= k
      bus.rev[i] *= k
      bus.dly[i] *= k
    }
  }
  eqStereo(bus.L, bus.R, [
    () => new Biquad('highpass', fem ? 140 : 95, 0.7),
    () => new Biquad('peak', 350, 0.9, -2.5),
    () => new Biquad('peak', fem ? 3200 : 2800, 0.9, 3),
    () => new Biquad('highshelf', 9500, 0.7, 2),
    () => new Biquad('lowpass', 15000, 0.7),
  ])
  compress(bus.L, bus.R, { threshDb: -16, ratio: 3, attackMs: 6, releaseMs: 90, kneeDb: 6, makeupDb: 3 })
  const g = plan.profile.genre
  const big = plan.profile.reverb
  applyReverb(bus.rev, bus.L, bus.R, { room: 0.66 + big * 0.28, damp: 0.38, wet: 0.95, predelayMs: 38, size: 0.95, hpHz: 300, lpHz: 9000 })
  const d = plan.spb * (g === 'rock' || g === 'punk' || g === 'metal' ? 0.5 : 0.75)
  applyDelay(bus.dly, bus.L, bus.R, d, 0.3, 0.5, 4000)
}

export interface Masters {
  mix: StereoBuffer
  instrumental: StereoBuffer
  vocals?: StereoBuffer
  lufs: number
}

/**
 * Balance vocals against the backing, glue-compress, normalise to ~-14 LUFS and limit to -1 dBFS.
 * The same gain chain is applied to the instrumental and vocal stems so they line up with the mix.
 */
export function master(inst: Bus, voc: Bus | null, plan: SongPlan, vocalMask: Float32Array | null): Masters {
  const n = inst.n
  // 1. nominal instrument level
  const ir = rms(inst.L, inst.R) || 1e-6
  const gi = 0.12 / ir
  for (let i = 0; i < n; i++) {
    inst.L[i] *= gi
    inst.R[i] *= gi
  }
  // 2. vocal level relative to backing during sung parts
  let gv = 0
  if (voc && vocalMask) {
    const vr = maskedRms(voc.L, voc.R, vocalMask) || 1e-6
    const ib = maskedRms(inst.L, inst.R, vocalMask) || 0.1
    const rel = plan.profile.genre === 'rock' || plan.profile.genre === 'metal' || plan.profile.genre === 'punk' ? -1.5 : plan.profile.genre === 'edm' ? -1 : 0.5
    gv = (ib * dbToGain(rel)) / vr
  }
  const mixL = new Float32Array(n)
  const mixR = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    mixL[i] = inst.L[i] + (voc ? voc.L[i] * gv : 0)
    mixR[i] = inst.R[i] + (voc ? voc.R[i] * gv : 0)
  }
  // 3. glue compression (identical settings on each output)
  const comp = { threshDb: -12, ratio: 2.2, attackMs: 12, releaseMs: 160, kneeDb: 8, makeupDb: 0 }
  compress(mixL, mixR, comp)
  // 4. loudness
  const lufs0 = measureLufs(mixL, mixR)
  let G = dbToGain(TARGET_LUFS - lufs0)
  for (let i = 0; i < n; i++) {
    mixL[i] *= G
    mixR[i] *= G
  }
  limit(mixL, mixR, CEILING, 4, 120)
  let lufs = measureLufs(mixL, mixR)
  if (lufs < TARGET_LUFS - 0.4) {
    // the limiter ate some loudness: one more gentle push
    const extra = dbToGain(Math.min(2.5, TARGET_LUFS - lufs))
    for (let i = 0; i < n; i++) {
      mixL[i] *= extra
      mixR[i] *= extra
    }
    limit(mixL, mixR, CEILING, 4, 120)
    G *= extra
    lufs = measureLufs(mixL, mixR)
  }
  // instrumental stem through the same chain
  compress(inst.L, inst.R, comp)
  for (let i = 0; i < n; i++) {
    inst.L[i] *= G
    inst.R[i] *= G
  }
  limit(inst.L, inst.R, CEILING, 4, 120)
  let vocals: StereoBuffer | undefined
  if (voc) {
    const k = gv * G
    for (let i = 0; i < n; i++) {
      voc.L[i] *= k
      voc.R[i] *= k
    }
    limit(voc.L, voc.R, CEILING, 4, 120)
    vocals = { sampleRate: SR, left: voc.L, right: voc.R }
  }
  return { mix: { sampleRate: SR, left: mixL, right: mixR }, instrumental: { sampleRate: SR, left: inst.L, right: inst.R }, vocals, lufs }
}
