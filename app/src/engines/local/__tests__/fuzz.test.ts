import { it, expect } from 'vitest'
import { parseLyrics } from '../../../lib/lyrics'
import { composeLocal, generateLocalLyrics, suggestStyles } from '../index'
it.skipIf(!process.env.FUZZ)('fuzz', async () => {
  for (let s = 0; s < 24; s++) {
    const style = suggestStyles(s * 77)
    const ly = generateLocalLyrics(style, s)
    const lyrics = parseLyrics(ly.lyrics)
    lyrics.sections = lyrics.sections.slice(0, 4)
    const r = await composeLocal({ title: ly.title, style, lyrics, instrumental: s % 5 === 0, seed: s * 13, weirdness: (s % 4) / 3, styleInfluence: ((s * 7) % 5) / 4, durationHint: 40, vocalGender: (['male', 'female', 'any'] as const)[s % 3] })
    let bad = 0, pk = 0
    for (const b of [r.mix, r.instrumental, ...(r.vocals ? [r.vocals] : [])]) for (const ch of [b.left, b.right]) for (const v of ch) { if (!Number.isFinite(v)) bad++; pk = Math.max(pk, Math.abs(v)) }
    expect(bad).toBe(0); expect(pk).toBeLessThan(0.892)
    let last = 0
    for (const l of r.timedLyrics) for (const w of l.words) { expect(w.start).toBeGreaterThanOrEqual(last); last = w.start; expect(w.end).toBeLessThanOrEqual(r.durationSec) }
    console.log(s, style, '=>', r.tags.join(', '), r.durationSec.toFixed(0) + 's')
  }
}, 300000)
