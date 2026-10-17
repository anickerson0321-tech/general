import { it } from 'vitest'
import { analyzePitch, polishVocal, levelParams, integratedLoudness, truePeak } from '../index'
import { synthVoice, synthF0At } from './synthVoice'

function medCents(y: Float32Array, sr: number, ref: (t: number) => number) {
  const tr = analyzePitch({ sampleRate: sr, data: y })
  const e: number[] = []
  for (let f = 0; f < tr.f0.length; f++) {
    const g = ref(f * tr.hopSec)
    if (tr.f0[f] > 0 && g === g) e.push(1200 * Math.log2(tr.f0[f] / g))
  }
  e.sort((a, b) => a - b)
  return { med: e[e.length >> 1], n: e.length }
}

it('scratch', () => {
  const sr = 48000
  const opts = { sr, duration: 4, notes: [{ start: 0.3, end: 1.8, midi: 69.4 }, { start: 2.0, end: 3.7, midi: 69.4 }], vibratoCents: 35, consonants: true, noiseFloor: 0.002 }
  const v = synthVoice(opts)
  const an = analyzePitch({ sampleRate: sr, data: v })
  for (const amount of [0, 10, 30, 50, 75, 100]) {
    const t0 = performance.now()
    const out = polishVocal({ sampleRate: sr, data: v }, { amount, key: { tonic: 9, mode: 'minor' }, analysis: an })
    const dt = performance.now() - t0
    const mono = new Float32Array(out.left.length)
    let nan = 0, pk = 0
    for (let i = 0; i < mono.length; i++) { mono[i] = 0.5 * (out.left[i] + out.right[i]); if (!(mono[i] === mono[i])) nan++; pk = Math.max(pk, Math.abs(out.left[i]), Math.abs(out.right[i])) }
    // compare to 440 Hz centre
    const r = medCents(out.left, sr, (t) => synthF0At(opts, t, false) / Math.pow(2, 40/1200))
    console.log(amount, 'ms', dt.toFixed(0), 'cents vs 440', r.med?.toFixed(1), 'n', r.n, 'peak', pk.toFixed(3), 'nan', nan, 'LUFS', integratedLoudness([out.left, out.right], sr).toFixed(1), 'TP', (20*Math.log10(truePeak([out.left, out.right]))).toFixed(2), 'str', levelParams(amount).pitchStrength.toFixed(2))
  }
})
