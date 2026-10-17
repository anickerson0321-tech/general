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
import { biquad, butterworth, dcBlock, designBiquad } from './biquad'
import { levelParams } from './chain'
import { spectralDenoise } from './denoise'
import { compress, deEss, tapeSaturate, vocalGate } from './dynamics'
import { integratedLoudness, limitStereo } from './master'
import { detectMarks, psolaShift } from './psola'
import { placeDoubles, renderDelay, renderReverb } from './space'
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

/** Long-term spectral tilt (dB/octave, 250 Hz–8 kHz) over voiced material. */
function measureTilt(x: Float32Array, sr: number, ct: CleanTrack): number {
  const centers = [250, 500, 1000, 2000, 4000, 8000].filter((f) => f < sr * 0.42)
  if (centers.length < 4) return NaN
  const mask = new Uint8Array(Math.ceil(x.length / 256))
  let any = 0
  for (let b = 0; b < mask.length; b++) {
    const f = Math.round((b * 256 + 128) / sr / ct.hopSec)
    mask[b] = f < ct.n && ct.voiced[f] ? 1 : 0
    any += mask[b]
  }
  if (any < 20) return NaN
  const ys: number[] = []
  const xs: number[] = []
  const tmp = new Float32Array(x.length)
  for (const fc of centers) {
    tmp.set(x)
    biquad(tmp, designBiquad('bandpass', fc, sr, 1.41))
    biquad(tmp, designBiquad('bandpass', fc, sr, 1.41))
    let e = 0
    for (let i = 0; i < tmp.length; i++) if (mask[i >> 8]) e += tmp[i] * tmp[i]
    ys.push(10 * Math.log10(e + 1e-20))
    xs.push(Math.log2(fc / 1000))
  }
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
  let x = sanitize(Float32Array.from(input.data))
  dcBlock(x, sr, 5)
  for (const s of butterworth('highpass', ch.highpassHz, sr, 4)) biquad(x, s)

  // ---- 2. pitch analysis (cached if provided)
  report(0.01, 'Analysing pitch')
  const track = params.analysis ?? analyzePitch(input, (f) => report(0.25 * f, 'Analysing pitch'))
  const ct = prepareTrack(track)
  report(0.25, 'Cleaning up')

  // ---- 3. gain staging
  const lv = measureLevels(x, sr, ct)
  const silent = lv.voiceDb < -90
  const inGainDb = silent ? 0 : clamp(REF_DB - lv.voiceDb, -20, 40)
  const inGain = Math.pow(10, inGainDb / 20)
  for (let i = 0; i < n; i++) x[i] *= inGain

  // ---- 4. stationary noise reduction
  if (ch.denoiseDb > 0.1 && !silent) x = spectralDenoise(x, sr, ch.denoiseDb).out
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
    x = psolaShift(x, marks, { shift: plan.shift, hopSec: ct.hopSec, formantPreserve: params.formantPreserve !== false })
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
  if (ch.mudDb < -0.01) biquad(x, designBiquad('peak', ch.mudHz, sr, 1.0, ch.mudDb))
  if (ch.harshDb < -0.01) biquad(x, designBiquad('peak', ch.harshHz, sr, 3.0, ch.harshDb))
  if (ch.tonalMatch > 0.01 && !silent) {
    const tilt = measureTilt(x, sr, ct)
    if (tilt === tilt) {
      const TARGET_TILT = -4.5 // dB/oct, typical polished pop vocal (octave-band energy)
      const t = clamp((TARGET_TILT - tilt) * 2.5 * ch.tonalMatch, -3, 3)
      if (Math.abs(t) > 0.05) {
        biquad(x, designBiquad('lowshelf', 280, sr, 0.7, -t))
        biquad(x, designBiquad('highshelf', 2500, sr, 0.7, t))
      }
    }
  }
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
  if (ch.presenceDb > 0.01) biquad(x, designBiquad('peak', ch.presenceHz, sr, 0.8, ch.presenceDb))
  if (ch.airDb > 0.01) biquad(x, designBiquad('highshelf', Math.min(ch.airHz, sr * 0.4), sr, 0.7, ch.airDb))
  deEss(x, sr, { freq: ch.deEssHz, q: 0.8, maxReductionDb: ch.deEssDb, thresholdDb: REF_DB - 24, relDb: -9 })
  tapeSaturate(x, sr, ch.saturation)
  if (ch.parallelMix > 0.001) {
    const smash = compress(x, sr, { thresholdDb: REF_DB - 20, ratio: 10, kneeDb: 3, attackMs: 1, releaseMs: 70, makeupDb: 14 }, new Float32Array(n))
    for (let i = 0; i < n; i++) x[i] += ch.parallelMix * smash[i]
  }
  const lead = x
  report(0.68, 'Adding space')

  // ---- 10. space
  const left = new Float32Array(lead)
  const right = new Float32Array(lead)
  const revSend = new Float32Array(lead)
  if (ch.doubleMix > 0.001 && !silent) {
    const hop = ct.hopSec
    const f0c = new Float32Array(ct.n)
    for (let i = 0; i < ct.n; i++) f0c[i] = ct.f0[i] * (shiftPlan ? Math.pow(2, shiftPlan[i] / 12) : 1)
    const marks = detectMarks(lead, sr, f0c, hop)
    const wanderA = new Float32Array(ct.n)
    const wanderB = new Float32Array(ct.n)
    for (let i = 0; i < ct.n; i++) {
      const t = i * hop
      wanderA[i] = 0.03 * Math.sin(2 * Math.PI * 0.23 * t) + 0.015 * Math.sin(2 * Math.PI * 0.61 * t + 1)
      wanderB[i] = 0.03 * Math.sin(2 * Math.PI * 0.19 * t + 2) + 0.015 * Math.sin(2 * Math.PI * 0.53 * t)
    }
    const det = ch.doubleDetuneCents / 100
    const dA = psolaShift(lead, marks, { shift: wanderA, hopSec: hop, offset: det })
    const dB = psolaShift(lead, marks, { shift: wanderB, hopSec: hop, offset: -det })
    const dbl = placeDoubles(dA, dB, sr, {
      delayMsL: ch.doubleDelayMs,
      delayMsR: ch.doubleDelayMs * 1.45,
      wanderMs: 2.5,
      width: ch.doubleWidth,
    })
    for (let i = 0; i < n; i++) {
      left[i] += ch.doubleMix * dbl.left[i]
      right[i] += ch.doubleMix * dbl.right[i]
      revSend[i] += 0.5 * ch.doubleMix * (dbl.left[i] + dbl.right[i])
    }
  }
  if (ch.slapMix > 0.001) {
    const slap = renderDelay(lead, sr, {
      msL: ch.slapMs,
      msR: ch.slapMs * 1.13,
      feedback: 0,
      pingPong: false,
      lowCutHz: 300,
      highCutHz: 5500,
      duckDb: 3,
    })
    for (let i = 0; i < n; i++) {
      left[i] += ch.slapMix * slap.left[i]
      right[i] += ch.slapMix * slap.right[i]
      revSend[i] += 0.3 * ch.slapMix * (slap.left[i] + slap.right[i])
    }
  }
  if (ch.echoMix > 0.001) {
    const echo = renderDelay(lead, sr, {
      msL: ch.echoMsL,
      msR: ch.echoMsR,
      feedback: ch.echoFeedback,
      pingPong: true,
      lowCutHz: 250,
      highCutHz: 4500,
      duckDb: 8,
    })
    for (let i = 0; i < n; i++) {
      left[i] += ch.echoMix * echo.left[i]
      right[i] += ch.echoMix * echo.right[i]
      revSend[i] += 0.3 * ch.echoMix * (echo.left[i] + echo.right[i])
    }
  }
  report(0.78, 'Adding reverb')
  if (ch.reverbMix > 0.001) {
    const rev = renderReverb(revSend, sr, {
      decaySec: ch.reverbDecaySec,
      size: ch.reverbSize,
      damping: ch.reverbDamping,
      preDelayMs: ch.reverbPreDelayMs,
      early: ch.reverbEarly,
      diffusion: ch.reverbDiffusion,
      lowCutHz: 180,
      highCutHz: 9000,
      width: 1,
    })
    for (let i = 0; i < n; i++) {
      left[i] += ch.reverbMix * rev.left[i]
      right[i] += ch.reverbMix * rev.right[i]
    }
  }
  report(0.9, 'Mastering')

  // ---- 11. loudness + limiter
  const rawL = new Float32Array(input.data)
  sanitize(rawL)
  const inLufs = integratedLoudness([rawL, rawL], sr)
  const curLufs = integratedLoudness([left, right], sr)
  if (curLufs > -90 && !silent) {
    const keep = inLufs > -90 ? inLufs : curLufs
    const want = ch.normalizeWeight * ch.targetLufs + (1 - ch.normalizeWeight) * keep
    let gDb = clamp(want - curLufs, -40, 40)
    const preL = new Float32Array(left)
    const preR = new Float32Array(right)
    for (let iter = 0; iter < 3; iter++) {
      const g = Math.pow(10, gDb / 20)
      for (let i = 0; i < n; i++) {
        left[i] = preL[i] * g
        right[i] = preR[i] * g
      }
      limitStereo(left, right, sr, { ceilingDb: ch.limiterCeilingDb, lookaheadMs: 2, releaseMs: 80 })
      const got = integratedLoudness([left, right], sr)
      const err = want - got
      if (!(got > -90) || Math.abs(err) < 0.4 || ch.normalizeWeight < 0.05) break
      gDb = clamp(gDb + err, gDb - 6, gDb + 6)
    }
  } else {
    limitStereo(left, right, sr, { ceilingDb: ch.limiterCeilingDb })
  }
  report(1, 'Done')
  return { sampleRate: sr, left, right }
}
