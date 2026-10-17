import { it } from 'vitest'
import { parseLyrics } from '../../../lib/lyrics'
import { arrange } from '../arrange'
import { SR } from '../dsp'
import { Bus } from '../instruments'
import { planSong } from '../plan'
import { generateLocalLyrics } from '../lyricsgen'
it.skipIf(!process.env.BALANCE)('balance', async () => {
  for (const style of (process.env.STYLES ?? 'upbeat pop, female vocals|dark trap, 140 bpm|acoustic folk ballad|80s synthwave, dreamy').split('|')) {
    const ly = generateLocalLyrics('summer', 7)
    const plan = planSong({ title: '', style, lyrics: parseLyrics(ly.lyrics), instrumental: false, seed: 7 })
    const bus = new Bus(Math.ceil((plan.musicSec + 2) * SR))
    await arrange(plan, bus, async () => {})
    const tot = Object.values(bus.energy).reduce((a, b) => a + b, 0)
    console.log(style, JSON.stringify(plan.profile.instruments))
    console.log(Object.entries(bus.energy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${(10 * Math.log10(v / tot)).toFixed(1)}`).join('  '))
  }
}, 60000)
