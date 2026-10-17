// Amount slider (0..100) → concrete chain parameters. Every parameter is a
// smooth monotone-cubic curve through keypoints, so the sound morphs
// continuously from Raw → Clean → Warm → Studio → Radio → Perfect.

import { clamp, makeCurve } from './util'

export interface LevelInfo {
  name: string
  short: string
  description: string
}

export interface ChainSummaryItem {
  id: string
  label: string
  /** 0..100 for UI meters */
  percent: number
}

export interface ResolvedChain {
  amount: number
  stage: LevelInfo
  // --- cleanup
  highpassHz: number
  /** spectral noise reduction depth (dB) */
  denoiseDb: number
  /** expander attenuation of background noise (dB) */
  gateRangeDb: number
  /** extra attenuation of breaths away from words (dB) */
  breathReductionDb: number
  // --- pitch
  /** 0..1 */
  pitchStrength: number
  retuneMs: number
  /** 0..1 fraction of natural vibrato depth kept */
  vibratoKeep: number
  // --- tone
  /** 0..1 strength of automatic tonal-balance (tilt) correction */
  tonalMatch: number
  mudHz: number
  mudDb: number
  harshHz: number
  harshDb: number
  presenceHz: number
  presenceDb: number
  airHz: number
  airDb: number
  // --- dynamics
  levelerRatio: number
  compRatio: number
  /** compressor threshold relative to the singer's typical level (dB) */
  compThresholdDb: number
  compAttackMs: number
  compReleaseMs: number
  /** max de-esser reduction on the 5–9 kHz band (dB) */
  deEssDb: number
  deEssHz: number
  /** 0..1 parallel ("New York") compression blend */
  parallelMix: number
  /** 0..1 tape saturation drive */
  saturation: number
  // --- space
  /** linear level of each double relative to the lead */
  doubleMix: number
  doubleDetuneCents: number
  doubleWidth: number
  doubleDelayMs: number
  slapMix: number
  slapMs: number
  echoMix: number
  echoMsL: number
  echoMsR: number
  echoFeedback: number
  /** wet/dry energy ratio of the reverb return */
  reverbMix: number
  reverbDecaySec: number
  /** 0..1 (room → plate → hall) */
  reverbSize: number
  reverbPreDelayMs: number
  reverbEarly: number
  reverbDiffusion: number
  reverbDamping: number
  // --- master
  /** 0..1 how much the output is pulled to targetLufs (else keeps the take's own loudness) */
  normalizeWeight: number
  targetLufs: number
  limiterCeilingDb: number
  summary: ChainSummaryItem[]
}

type Pts = ReadonlyArray<readonly [number, number]>
const C = (pts: Pts): ((x: number) => number) => makeCurve(pts)

const curves = {
  highpassHz: C([[0, 20], [8, 75], [30, 90], [100, 100]]),
  denoiseDb: C([[0, 0], [15, 6], [40, 9], [100, 10]]),
  gateRangeDb: C([[0, 0], [15, 12], [40, 18], [70, 24], [100, 30]]),
  breathReductionDb: C([[0, 0], [15, 6], [40, 9], [70, 12], [100, 14]]),
  pitchStrength: C([[0, 0], [18, 0], [30, 0.3], [45, 0.5], [55, 0.65], [70, 0.85], [80, 0.9], [90, 0.97], [100, 1]]),
  retuneMs: C([[0, 160], [20, 150], [35, 120], [45, 80], [60, 45], [70, 25], [80, 16], [90, 13], [100, 12]]),
  vibratoKeep: C([[0, 1], [70, 1], [85, 0.8], [100, 0.55]]),
  tonalMatch: C([[0, 0], [20, 0], [50, 0.45], [100, 0.55]]),
  mudDb: C([[0, 0], [20, 0], [35, -2.5], [60, -3], [100, -3.5]]),
  harshDb: C([[0, 0], [20, 0], [40, -1.5], [100, -2]]),
  presenceDb: C([[0, 0], [20, 0], [40, 2], [70, 2.5], [85, 3.5], [100, 3.2]]),
  airDb: C([[0, 0], [20, 0], [40, 2], [70, 3], [85, 4.5], [100, 4.5]]),
  levelerRatio: C([[0, 1], [15, 1.6], [40, 2], [100, 2]]),
  compRatio: C([[0, 1], [15, 1.3], [35, 3], [55, 3.5], [80, 4.5], [100, 4]]),
  compThresholdDb: C([[0, 0], [20, -4], [40, -8], [70, -12], [100, -12]]),
  compAttackMs: C([[0, 20], [40, 10], [70, 5], [100, 4]]),
  compReleaseMs: C([[0, 200], [40, 120], [100, 90]]),
  deEssDb: C([[0, 0], [20, 0], [30, 4], [50, 6], [80, 8], [100, 8]]),
  parallelMix: C([[0, 0], [65, 0], [80, 0.3], [100, 0.3]]),
  saturation: C([[0, 0], [40, 0], [55, 0.25], [75, 0.4], [100, 0.35]]),
  doubleMix: C([[0, 0], [45, 0], [60, 0.12], [80, 0.2], [100, 0.18]]),
  doubleDetuneCents: C([[0, 6], [45, 6], [80, 9], [100, 8]]),
  doubleWidth: C([[0, 0.6], [45, 0.6], [80, 0.9], [100, 0.9]]),
  doubleDelayMs: C([[0, 12], [45, 12], [80, 18], [100, 16]]),
  slapMix: C([[0, 0], [45, 0], [60, 0.1], [75, 0.08], [100, 0.06]]),
  echoMix: C([[0, 0], [65, 0], [85, 0.12], [100, 0.12]]),
  echoFeedback: C([[0, 0.25], [65, 0.25], [90, 0.32], [100, 0.32]]),
  reverbMix: C([[0, 0], [20, 0], [35, 0.1], [55, 0.16], [75, 0.2], [90, 0.22], [100, 0.22]]),
  reverbDecaySec: C([[0, 0.45], [20, 0.45], [40, 0.6], [55, 1.3], [75, 1.8], [100, 2.0]]),
  reverbSize: C([[0, 0.3], [20, 0.3], [45, 0.45], [60, 0.65], [80, 0.8], [100, 0.8]]),
  reverbPreDelayMs: C([[0, 8], [20, 8], [55, 25], [80, 40], [100, 40]]),
  reverbEarly: C([[0, 1], [20, 1], [45, 0.6], [60, 0.15], [100, 0.1]]),
  reverbDiffusion: C([[0, 0.6], [20, 0.6], [55, 0.9], [100, 0.95]]),
  reverbDamping: C([[0, 0.55], [40, 0.5], [60, 0.35], [100, 0.3]]),
  normalizeWeight: C([[0, 0], [15, 0], [60, 0.6], [85, 1], [100, 1]]),
  targetLufs: C([[0, -20], [50, -18], [75, -16], [90, -14], [100, -14]]),
  limiterCeilingDb: C([[0, -0.1], [50, -0.5], [80, -1], [100, -1]]),
}

const STAGES: Array<{ from: number; info: LevelInfo }> = [
  {
    from: 0,
    info: { name: 'Raw', short: 'Untouched', description: 'Your take exactly as recorded — no processing at all.' },
  },
  {
    from: 1,
    info: {
      name: 'Clean',
      short: 'Noise cleanup',
      description: 'Rumble and room noise removed, breaths tamed, levels gently evened out. Still 100% your natural voice.',
    },
  },
  {
    from: 22,
    info: {
      name: 'Warm',
      short: 'EQ, compression, light tuning',
      description:
        'Mud cut, presence and air added, smooth 3:1 compression, de-essing, a small room, and a gentle nudge toward the right notes that keeps your vibrato and slides.',
    },
  },
  {
    from: 45,
    info: {
      name: 'Studio',
      short: 'Tuned & polished',
      description:
        'Confident pitch correction, plate reverb, a short slap echo, subtle tape warmth and soft stereo doubles — a finished studio vocal.',
    },
  },
  {
    from: 68,
    info: {
      name: 'Radio',
      short: 'Big, bright, upfront',
      description:
        'Tight, fast tuning, parallel compression, wide doubles, brighter EQ, bigger reverb and echo, limited for a loud, radio-ready sound.',
    },
  },
  {
    from: 88,
    info: {
      name: 'Perfect',
      short: 'Pitch-perfect',
      description:
        'Every note lands dead-on with natural transitions and softened vibrato, full polish, loudness-matched to streaming level.',
    },
  },
]

/** Human-readable stage for the UI. */
export function describeLevel(amount: number): LevelInfo {
  const a = clamp(amount === amount ? amount : 0, 0, 100)
  if (a <= 0) return { ...STAGES[0].info }
  let info = STAGES[1].info
  for (const s of STAGES) if (a >= s.from && s.from > 0) info = s.info
  return { ...info }
}

/** The concrete parameter values for a slider position. */
export function levelParams(amount: number): ResolvedChain {
  const a = clamp(amount === amount ? amount : 0, 0, 100)
  const v = (k: keyof typeof curves): number => curves[k](a)
  const chain: ResolvedChain = {
    amount: a,
    stage: describeLevel(a),
    highpassHz: v('highpassHz'),
    denoiseDb: v('denoiseDb'),
    gateRangeDb: v('gateRangeDb'),
    breathReductionDb: v('breathReductionDb'),
    pitchStrength: clamp(v('pitchStrength'), 0, 1),
    retuneMs: v('retuneMs'),
    vibratoKeep: clamp(v('vibratoKeep'), 0, 1),
    tonalMatch: v('tonalMatch'),
    mudHz: 320,
    mudDb: v('mudDb'),
    harshHz: 3000,
    harshDb: v('harshDb'),
    presenceHz: 4700,
    presenceDb: v('presenceDb'),
    airHz: 11000,
    airDb: v('airDb'),
    levelerRatio: v('levelerRatio'),
    compRatio: v('compRatio'),
    compThresholdDb: v('compThresholdDb'),
    compAttackMs: v('compAttackMs'),
    compReleaseMs: v('compReleaseMs'),
    deEssDb: v('deEssDb'),
    deEssHz: 6800,
    parallelMix: v('parallelMix'),
    saturation: v('saturation'),
    doubleMix: v('doubleMix'),
    doubleDetuneCents: v('doubleDetuneCents'),
    doubleWidth: v('doubleWidth'),
    doubleDelayMs: v('doubleDelayMs'),
    slapMix: v('slapMix'),
    slapMs: 105,
    echoMix: v('echoMix'),
    echoMsL: 330,
    echoMsR: 440,
    echoFeedback: v('echoFeedback'),
    reverbMix: v('reverbMix'),
    reverbDecaySec: v('reverbDecaySec'),
    reverbSize: v('reverbSize'),
    reverbPreDelayMs: v('reverbPreDelayMs'),
    reverbEarly: v('reverbEarly'),
    reverbDiffusion: v('reverbDiffusion'),
    reverbDamping: v('reverbDamping'),
    normalizeWeight: clamp(v('normalizeWeight'), 0, 1),
    targetLufs: v('targetLufs'),
    limiterCeilingDb: v('limiterCeilingDb'),
    summary: [],
  }
  const pct = (x: number): number => Math.round(clamp(x, 0, 1) * 100)
  chain.summary = [
    { id: 'cleanup', label: 'Noise cleanup', percent: pct(chain.gateRangeDb / 30) },
    { id: 'pitch', label: 'Pitch correction', percent: pct(chain.pitchStrength) },
    { id: 'eq', label: 'EQ / tone', percent: pct((Math.abs(chain.mudDb) + chain.presenceDb + chain.airDb) / 12) },
    { id: 'compression', label: 'Compression', percent: pct((chain.compRatio - 1) / 3.5 + chain.parallelMix * 0.5) },
    { id: 'deess', label: 'De-esser', percent: pct(chain.deEssDb / 8) },
    { id: 'saturation', label: 'Saturation', percent: pct(chain.saturation / 0.4) },
    { id: 'doubles', label: 'Doubling', percent: pct(chain.doubleMix / 0.2) },
    { id: 'delay', label: 'Echo', percent: pct((chain.slapMix + chain.echoMix) / 0.2) },
    { id: 'reverb', label: 'Reverb', percent: pct(chain.reverbMix) },
    { id: 'loudness', label: 'Loudness', percent: pct(chain.normalizeWeight) },
  ]
  return chain
}
