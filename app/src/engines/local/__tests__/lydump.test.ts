import { it } from 'vitest'
import { generateLocalLyrics } from '../lyricsgen'
it.skipIf(!process.env.LYDUMP)('ly', () => {
  for (const [p, s] of [['a road trip with my best friends in summer', 1], ['heartbreak after a long winter', 2], ['neon city at midnight', 3]] as const) {
    const r = generateLocalLyrics(p, s)
    console.log('### ' + r.title + '\n' + r.lyrics + '\n')
  }
})
