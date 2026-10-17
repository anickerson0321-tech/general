import { it } from 'vitest'
import { parseLyrics } from '../../../lib/lyrics'
import { composeLocal, generateLocalLyrics } from '../index'
it.skipIf(!process.env.PERFALL)('perf all', async () => {
  const ly = parseLyrics(generateLocalLyrics('city lights', 5).lyrics)
  for (const style of ['epic orchestral cinematic', 'heavy metal', 'deep house', 'gospel', 'smooth jazz', 'lofi', 'k-pop', 'pop punk', 'acoustic folk', 'reggae', 'country']) {
    const t0 = performance.now()
    const r = await composeLocal({ title: '', style, lyrics: ly, instrumental: false, seed: 5, durationHint: 150 })
    console.log(style.padEnd(28), (performance.now() - t0).toFixed(0).padStart(6), 'ms', r.durationSec.toFixed(1), 's')
  }
}, 300000)
