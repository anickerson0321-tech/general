// polishVocal: the full vocal chain driven by one 0..100 amount.
//
//   sanitize → DC/high-pass → (analysis) → input gain staging → spectral denoise
//   → PSOLA pitch correction → vocal-aware expander → subtractive EQ + auto tilt
//   → leveler → compressor → presence/air EQ → de-esser → tape saturation
//   → parallel compression  ══ lead ══
//   → doubles (PSOLA micro-shift + wandering delay, panned) / slap / ping-pong
//     echo (ducked) / FDN reverb → stereo mix → loudness blend → true-peak limiter

import type { MelodyNote, MonoBuffer, MusicalKey, ProgressFn, StereoBuffer } from '../types'
import type { PitchTrack } from './pitch'
import type { CleanTrack } from './track'
import type { ResolvedChain } from './chain'
import { analyzePitch } from './pitch'
import { fft } from './fft'
import type { Biquad } from './biquad'
import { STREAM_BLOCK, butterworth, cascade, cascadeState, cascadeStream, dcBlock, designBiquad } from './biquad'
import { levelParams } from './chain'
import { spectralDenoise } from './denoise'
import { compress, deEss, tapeSaturate, vocalGate } from './dynamics'
import { integratedLoudness, limitStereo } from './master'
import { detectMarks, psolaShift } from './psola'
import type { WetBus } from './space'
import { addDelay, addDouble, addReverb } from './space'
import { notesFromTrack, prepareTrack } from './track'
import { planCorrection } from './tune'
import { clamp, percentile, sanitize, smoothstep } from './util'

export interface PolishParams {
  amount: number // 0..100 slider
  key?: MusicalKey // song key, used for scale snapping fallback
  targetMelody?: MelodyNote[] // known melody, times relative to SONG start
  guideTrack?: PitchTrack // pitch track of the AI guide vocal, times relative to SONG start
  takeOffsetSec?: number // where the take starts within the song (default 0)
  analysis?: PitchTrack // cached analyzePitch() of THIS input (skip re-analysis if given)
  robotic?: boolean // optional "hard tune" effect toggle (instant retune, no humanize)
  formantPreserve?: boolean // default true
}

/** Internal reference level: the singer's typical level is staged to this (dBFS RMS). */
const REF_DB = -18

function rawCopy(input: MonoBuffer): StereoBuffer {
  const n = input.data.length
  const left = new Float32Array(n)
  const src = input.data
  for (let i = 0; i < n; i++) {
    const v = src[i]
    left[i] = v === v ? (v > 1 ? 1 : v < -1 ? -1 : v) : 0
  }
  return { sampleRate: input.sampleRate, left, right: new Float32Array(left) }
}

interface Levels {
  voiceDb: number
  noiseDb: number
}

function measureLevels(x: Float32Array, sr: number, ct: CleanTrack | null): Levels {
  const n = x.length
  const B = Math.max(1, Math.round(0.02 * sr))
  const nb = Math.floor(n / B)
  const blocks = new Float32Array(Math.max(0, nb))
  const voicedBlocks: number[] = []
  for (let b = 0; b < nb; b++) {
    let s = 0
    for (let i = b * B; i < (b + 1) * B; i++) s += x[i] * x[i]
    const db = 10 * Math.log10(s / B + 1e-20)
    blocks[b] = db
    if (ct) {
      const f = Math.round(((b + 0.5) * B) / sr / ct.hopSec)
      if (f < ct.n && ct.voiced[f]) voicedBlocks.push(db)
    }
  }
  const audible: number[] = []
  for (let b = 0; b < nb; b++) if (blocks[b] > -100) audible.push(blocks[b])
  if (audible.length === 0) return { voiceDb: -100, noiseDb: -110 }
  const voiceDb = voicedBlocks.length >= 10 ? percentile(voicedBlocks, 0.7) : percentile(audible, 0.95)
  const noiseDb = Math.min(percentile(audible, 0.1), voiceDb - 6)
  return { voiceDb, noiseDb }
}

/** Long-term spectral tilt (dB/octave, 250 Hz–8 kHz) over voiced material, from sampled FFT frames. */
function measureTilt(x: Float32Array, sr: number, ct: CleanTrack): number {
  const centers = [250, 500, 1000, 2000, 4000, 8000].filter((f) => f * 1.41 < sr * 0.5)
  if (centers.length < 4) return NaN
  const N = 2048
  const starts: number[] = []
  for (let f = 0; f < ct.n; f++) {
    if (!ct.voiced[f]) continue
    const s0 = Math.round(f * ct.hopSec * sr) - N / 2
    if (s0 >= 0 && s0 + N <= x.length) starts.push(s0)
  }
  if (starts.length < 20) return NaN
  const MAXF = 400
  const pick: number[] = []
  const stride = Math.max(1, starts.length / MAXF)
  for (let k = 0; k < starts.length && pick.length < MAXF; k += stride) pick.push(starts[Math.floor(k)])
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  const bandE = new Float64Array(centers.length)
  const binHz = sr / N
  for (const s0 of pick) {
    for (let i = 0; i < N; i++) {
      re[i] = x[s0 + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
      im[i] = 0
    }
    fft(re, im)
    for (let b = 0; b < centers.length; b++) {
      const k0 = Math.max(1, Math.floor(centers[b] / Math.SQRT2 / binHz))
      const k1 = Math.min(N / 2, Math.ceil((centers[b] * Math.SQRT2) / binHz))
      let e = 0
      for (let k = k0; k < k1; k++) e += re[k] * re[k] + im[k] * im[k]
      bandE[b] += e
    }
  }
  const xs = centers.map((f) => Math.log2(f / 1000))
  const ys = Array.from(bandE, (e) => 10 * Math.log10(e + 1e-20))
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  let num = 0
  let den = 0
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) * (xs[i] - mx)
  }
  return num / den
}

/** 2:1 decimation (8th-order Butterworth anti-alias at ~0.22·sr), block-streamed into `out` (length n>>1). */
function decimate2Into(x: Float32Array, sr: number, out: Float32Array): void {
  const secs = butterworth('lowpass', Math.min(10500, sr * 0.22), sr, 8)
  const st = cascadeState(secs)
  const blk = new Float32Array(STREAM_BLOCK)
  const m = out.length
  for (let b0 = 0; b0 < 2 * m; b0 += STREAM_BLOCK) {
    const len = Math.min(STREAM_BLOCK, x.length - b0)
    blk.set(x.subarray(b0, b0 + len))
    cascadeStream(blk, secs, st, len)
    for (let j = 0; j < len; j += 2) if ((b0 + j) >> 1 < m) out[(b0 + j) >> 1] = blk[j]
  }
}

/**
 * Final mix: right = lead + up(wetR), left = lead + up(wetL), where up() is 1:2 linear
 * interpolation followed by a 4th-order low-pass at ~0.22·sr. `left` may alias `lead`.
 */
function mixUpsampled(
  lead: Float32Array,
  wetL: Float32Array,
  wetR: Float32Array,
  left: Float32Array,
  right: Float32Array,
  sr: number,
): void {
  const n = lead.length
  const m = wetL.length
  const secs = butterworth('lowpass', Math.min(10500, sr * 0.22), sr, 4)
  const stL = cascadeState(secs)
  const stR = cascadeState(secs)
  const bL = new Float32Array(STREAM_BLOCK)
  const bR = new Float32Array(STREAM_BLOCK)
  for (let b0 = 0; b0 < n; b0 += STREAM_BLOCK) {
    const len = Math.min(STREAM_BLOCK, n - b0)
    for (let k = 0; k < len; k++) {
      const i = b0 + k
      const j = i >> 1
      if (j >= m) {
        bL[k] = 0
        bR[k] = 0
      } else if (i & 1) {
        bL[k] = 0.5 * (wetL[j] + (j + 1 < m ? wetL[j + 1] : 0))
        bR[k] = 0.5 * (wetR[j] + (j + 1 < m ? wetR[j + 1] : 0))
      } else {
        bL[k] = wetL[j]
        bR[k] = wetR[j]
      }
    }
    cascadeStream(bL, secs, stL, len)
    cascadeStream(bR, secs, stR, len)
    for (let k = 0; k < len; k++) {
      const i = b0 + k
      const d = lead[i]
      right[i] = d + bR[k]
      left[i] = d + bL[k]
    }
  }
}

function shiftNotes(notes: MelodyNote[], offset: number, durSec: number): MelodyNote[] {
  return notes
    .filter((nt) => nt.end - offset > -1 && nt.start - offset < durSec + 1 && nt.end > nt.start && nt.midi === nt.midi)
    .map((nt) => ({ ...nt, start: nt.start - offset, end: nt.end - offset }))
    .sort((a, b) => a.start - b.start)
}

/** Returns a processed stereo take, sample-aligned with and the same length as the input. */
export function polishVocal(input: MonoBuffer, params: PolishParams, onProgress?: ProgressFn): StereoBuffer {
  const sr = input.sampleRate
  const n = input.data.length
  const amount = clamp(params.amount === params.amount ? params.amount : 0, 0, 100)
  if (amount <= 0 || n === 0) return rawCopy(input)
  const ch: ResolvedChain = levelParams(amount)
  const report = (f: number, label: string): void => onProgress?.(clamp(f, 0, 1), label)

  // ---- 1. sanitize, DC, high-pass
  // `x` is the lead, processed in place throughout; it becomes the LEFT output channel.
  const x = sanitize(Float32Array.from(input.data))
  const inLufs = integratedLoudness([x, x], sr) // dual-mono, filtered once
  dcBlock(x, sr, 5)
  cascade(x, butterworth('highpass', ch.highpassHz, sr, 4))

  // ---- 2. pitch analysis (cached if provided)
  report(0.01, 'Analysing pitch')
  const track = params.analysis ?? analyzePitch(input, (f) => report(0.01 + 0.24 * f, 'Analysing pitch'))
  const ct = prepareTrack(track)
  report(0.25, 'Cleaning up')

  // ---- 3. gain staging
  const lv = measureLevels(x, sr, ct)
  const silent = lv.voiceDb < -90
  const inGainDb = silent ? 0 : clamp(REF_DB - lv.voiceDb, -20, 40)
  const inGain = Math.pow(10, inGainDb / 20)
  for (let i = 0; i < n; i++) x[i] *= inGain

  // ---- 4. stationary noise reduction
  if (ch.denoiseDb > 0.1 && !silent) spectralDenoise(x, sr, ch.denoiseDb) // in place
  report(0.33, 'Tuning')

  // ---- 5. pitch correction (TD-PSOLA)
  const roboticMix = params.robotic ? smoothstep(30, 40, amount) : 0
  let shiftPlan: Float32Array | null = null
  if ((ch.pitchStrength > 0.001 || roboticMix > 0) && !silent) {
    const off = params.takeOffsetSec ?? 0
    const dur = n / sr
    const melody = params.targetMelody?.length ? shiftNotes(params.targetMelody, off, dur) : undefined
    const guide = params.guideTrack ? shiftNotes(notesFromTrack(params.guideTrack), off, dur) : undefined
    const plan = planCorrection(ct, {
      strength: ch.pitchStrength,
      retuneMs: ch.retuneMs,
      vibratoKeep: ch.vibratoKeep,
      robotic: roboticMix,
      key: params.key,
      melody,
      guide,
    })
    shiftPlan = plan.shift
    const marks = detectMarks(x, sr, ct.f0, ct.hopSec)
    psolaShift(x, marks, { shift: plan.shift, hopSec: ct.hopSec, formantPreserve: params.formantPreserve !== false }, x) // in place
  }
  report(0.5, 'Cleaning up')

  // ---- 6. vocal-aware expander / breath control
  const post = measureLevels(x, sr, ct)
  vocalGate(x, sr, {
    noiseRangeDb: ch.gateRangeDb,
    breathRangeDb: ch.breathReductionDb,
    noiseFloorDb: Math.min(post.noiseDb, REF_DB - 12),
    voiceDb: silent ? REF_DB : post.voiceDb,
    voiced: ct.voiced,
    hopSec: ct.hopSec,
  })

  // ---- 7. subtractive EQ + automatic tonal balance
  const sub: Biquad[] = []
  if (ch.mudDb < -0.01) sub.push(designBiquad('peak', ch.mudHz, sr, 1.0, ch.mudDb))
  if (ch.harshDb < -0.01) sub.push(designBiquad('peak', ch.harshHz, sr, 3.0, ch.harshDb))
  if (ch.tonalMatch > 0.01 && !silent) {
    const tilt = measureTilt(x, sr, ct)
    if (tilt === tilt) {
      const TARGET_TILT = -4.5 // dB/oct, typical polished pop vocal (octave-band energy)
      const t = clamp((TARGET_TILT - tilt) * 2.5 * ch.tonalMatch, -3, 3)
      if (Math.abs(t) > 0.05) {
        sub.push(designBiquad('lowshelf', 280, sr, 0.7, -t))
        sub.push(designBiquad('highshelf', 2500, sr, 0.7, t))
      }
    }
  }
  cascade(x, sub)
  report(0.58, 'Compressing')

  // ---- 8. dynamics
  compress(x, sr, { thresholdDb: REF_DB - 6, ratio: ch.levelerRatio, kneeDb: 10, attackMs: 30, releaseMs: 350, rmsMs: 40 })
  compress(x, sr, {
    thresholdDb: REF_DB + ch.compThresholdDb,
    ratio: ch.compRatio,
    kneeDb: 6,
    attackMs: ch.compAttackMs,
    releaseMs: ch.compReleaseMs,
    rmsMs: 4,
  })

  // ---- 9. tone EQ, de-ess, colour
  const tone: Biquad[] = []
  if (ch.presenceDb > 0.01) tone.push(designBiquad('peak', ch.presenceHz, sr, 0.8, ch.presenceDb))
  if (ch.airDb > 0.01) tone.push(designBiquad('highshelf', Math.min(ch.airHz, sr * 0.4), sr, 0.7, ch.airDb))
  cascade(x, tone)
  deEss(x, sr, { freq: ch.deEssHz, q: 0.8, maxReductionDb: ch.deEssDb, thresholdDb: REF_DB - 24, relDb: -9 })
  tapeSaturate(x, sr, ch.saturation)
  if (ch.parallelMix > 0.001) {
    // parallel ("New York") compression blended in place: x · (1 + mix · gain)
    compress(x, sr, { thresholdDb: REF_DB - 20, ratio: 10, kneeDb: 3, attackMs: 1, releaseMs: 70, makeupDb: 14, blend: ch.parallelMix })
  }
  const lead = x
  report(0.68, 'Adding space')

  // ---- 10. space — the wet bus runs at half rate (all returns are band-limited < 10 kHz).
  // Memory plan (phone workers): the RIGHT output buffer is allocated now and its two
  // halves host the half-rate lead and the reverb send; wet effects stream and accumulate
  // in place; the upsampled wet bus is mixed straight into left/right at the end.
  const wantDoubles = ch.doubleMix > 0.001 && !silent
  const anyWet = wantDoubles || ch.slapMix > 0.001 || ch.echoMix > 0.001 || ch.reverbMix > 0.001
  const right = new Float32Array(n)
  const left = x
  if (anyWet) {
    const half = sr >= 44100
    const wsr = half ? sr / 2 : sr
    const nW = half ? n >> 1 : n
    let leadW: Float32Array
    let revSend: Float32Array
    if (half) {
      leadW = right.subarray(0, nW)
      revSend = right.subarray(nW, 2 * nW)
      decimate2Into(lead, sr, leadW)
    } else {
      leadW = lead
      revSend = right
    }
    const bus: WetBus = { left: new Float32Array(nW), right: new Float32Array(nW) }
    if (wantDoubles) {
      const hop = ct.hopSec
      const f0c = new Float32Array(ct.n)
      for (let i = 0; i < ct.n; i++) f0c[i] = ct.f0[i] * (shiftPlan ? Math.pow(2, shiftPlan[i] / 12) : 1)
      const marks = detectMarks(leadW, wsr, f0c, hop)
      const wanderA = new Float32Array(ct.n)
      const wanderB = new Float32Array(ct.n)
      for (let i = 0; i < ct.n; i++) {
        const t = i * hop
        wanderA[i] = 0.03 * Math.sin(2 * Math.PI * 0.23 * t) + 0.015 * Math.sin(2 * Math.PI * 0.61 * t + 1)
        wanderB[i] = 0.03 * Math.sin(2 * Math.PI * 0.19 * t + 2) + 0.015 * Math.sin(2 * Math.PI * 0.53 * t)
      }
      const det = ch.doubleDetuneCents / 100
      const dp = { delayMsL: ch.doubleDelayMs, delayMsR: ch.doubleDelayMs * 1.45, wanderMs: 2.5, width: ch.doubleWidth }
      // the (not yet built) reverb-send storage doubles as the PSOLA scratch
      psolaShift(leadW, marks, { shift: wanderA, hopSec: hop, offset: det }, revSend)
      addDouble(revSend, wsr, 0, dp, ch.doubleMix, bus)
      psolaShift(leadW, marks, { shift: wanderB, hopSec: hop, offset: -det }, revSend)
      addDouble(revSend, wsr, 1, dp, ch.doubleMix, bus)
      // reverb send = lead + 0.5 × doubles (the bus holds only the doubles so far)
      for (let i = 0; i < nW; i++) revSend[i] = leadW[i] + 0.5 * (bus.left[i] + bus.right[i])
    } else revSend.set(leadW)
    bus.send = revSend
    if (ch.slapMix > 0.001) {
      const sp = { msL: ch.slapMs, msR: ch.slapMs * 1.13, feedback: 0, pingPong: false, lowCutHz: 300, highCutHz: 5500, duckDb: 3 }
      addDelay(leadW, wsr, sp, ch.slapMix, bus, 0.3)
    }
    if (ch.echoMix > 0.001) {
      const ep = {
        msL: ch.echoMsL,
        msR: ch.echoMsR,
        feedback: ch.echoFeedback,
        pingPong: true,
        lowCutHz: 250,
        highCutHz: 4500,
        duckDb: 8,
      }
      addDelay(leadW, wsr, ep, ch.echoMix, bus, 0.3)
    }
    report(0.78, 'Adding reverb')
    if (ch.reverbMix > 0.001) {
      const rp = {
        decaySec: ch.reverbDecaySec,
        size: ch.reverbSize,
        damping: ch.reverbDamping,
        preDelayMs: ch.reverbPreDelayMs,
        early: ch.reverbEarly,
        diffusion: ch.reverbDiffusion,
        lowCutHz: 180,
        highCutHz: 9000,
        width: 1,
      }
      // tank scratch: the half-rate lead's storage is free now (when it isn't the lead itself)
      const scratchL = half ? leadW : new Float32Array(nW)
      addReverb(revSend, wsr, rp, ch.reverbMix, { left: bus.left, right: bus.right }, scratchL)
    }
    // final mix: right = lead + wetR, left = lead + wetL (upsampled on the fly when half-rate)
    if (half) mixUpsampled(lead, bus.left, bus.right, left, right, sr)
    else
      for (let i = 0; i < n; i++) {
        right[i] = lead[i] + bus.right[i]
        left[i] = lead[i] + bus.left[i]
      }
  } else right.set(lead)
  report(0.9, 'Mastering')

  // ---- 11. loudness + limiter (gain chosen by exact measure-only limiter passes; one real pass)
  const curLufs = integratedLoudness([left, right], sr)
  const lim = { ceilingDb: ch.limiterCeilingDb, lookaheadMs: 2, releaseMs: 80 }
  if (curLufs > -90 && !silent) {
    const keep = inLufs > -90 ? inLufs : curLufs
    const want = ch.normalizeWeight * ch.targetLufs + (1 - ch.normalizeWeight) * keep
    let gDb = clamp(want - curLufs, -40, 40)
    if (ch.normalizeWeight >= 0.05) {
      const got = limitStereo(left, right, sr, lim, { preGain: Math.pow(10, gDb / 20), measureOnly: true }).lufs
      const err = want - got
      if (got > -90 && Math.abs(err) >= 0.4) gDb = clamp(gDb + err, gDb - 6, gDb + 6)
    }
    limitStereo(left, right, sr, lim, { preGain: Math.pow(10, gDb / 20) })
  } else {
    limitStereo(left, right, sr, { ceilingDb: ch.limiterCeilingDb })
  }
  // seamless start of the slider: cross-fade from the untouched take over amounts 0..3
  if (amount < 3) {
    const w = smoothstep(0, 3, amount)
    const src = input.data
    for (let i = 0; i < n; i++) {
      const v = src[i]
      const d = v === v ? (v > 1 ? 1 : v < -1 ? -1 : v) : 0
      left[i] = d + w * (left[i] - d)
      right[i] = d + w * (right[i] - d)
    }
  }
  report(1, 'Done')
  return { sampleRate: sr, left, right }
}
