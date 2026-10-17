import { audioCtx } from './audio'
import { MicRecorder } from './recorder'

/**
 * Measure round-trip audio latency: play 6 clicks out of the speaker, record them with the mic,
 * and compare when they arrived with when they were scheduled. Returns the EXTRA latency (ms)
 * beyond what the browser already reports, i.e. the value to store in settings.latencyMs.
 */
export async function measureLatency(onStatus?: (s: string) => void): Promise<{ extraMs: number; totalMs: number; hits: number }> {
  const ctx = audioCtx()
  const mic = new MicRecorder()
  await mic.open({ echoCancellation: false })
  try {
    const sr = ctx.sampleRate
    const click = ctx.createBuffer(1, Math.floor(sr * 0.01), sr)
    const d = click.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.sin((2 * Math.PI * 2000 * i) / sr) * Math.exp(-i / (sr * 0.002))
    const gain = ctx.createGain()
    gain.gain.value = 0.9
    gain.connect(ctx.destination)
    onStatus?.('Listening…')
    mic.start()
    await new Promise((r) => setTimeout(r, 300))
    const t0 = ctx.currentTime + 0.3
    const times: number[] = []
    for (let k = 0; k < 6; k++) {
      const s = ctx.createBufferSource()
      s.buffer = click
      s.connect(gain)
      const when = t0 + k * 0.5
      s.start(when)
      times.push(when)
    }
    await new Promise((r) => setTimeout(r, (0.3 + 6 * 0.5 + 0.6) * 1000))
    const { data, firstCtxTime } = mic.stop()
    gain.disconnect()
    // onset detection: first sample above threshold after each scheduled click
    let peakAll = 0
    for (let i = 0; i < data.length; i++) peakAll = Math.max(peakAll, Math.abs(data[i]))
    if (peakAll < 0.02) throw new Error('Could not hear the clicks — turn the volume up and take off headphones.')
    const thr = peakAll * 0.35
    const lags: number[] = []
    for (const when of times) {
      const start = Math.max(0, Math.floor((when - firstCtxTime) * sr))
      const end = Math.min(data.length, start + Math.floor(sr * 0.45))
      for (let i = start; i < end; i++) {
        if (Math.abs(data[i]) > thr) {
          lags.push(i / sr + firstCtxTime - when)
          break
        }
      }
    }
    if (lags.length < 3) throw new Error('Too few clicks detected. Try again in a quieter room.')
    lags.sort((a, b) => a - b)
    const total = lags[Math.floor(lags.length / 2)]
    const reported = mic.roundTripLatency
    return { extraMs: Math.round((total - reported) * 1000), totalMs: Math.round(total * 1000), hits: lags.length }
  } finally {
    mic.close()
  }
}
