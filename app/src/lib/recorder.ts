import { audioCtx } from './audio'

// Mic capture via AudioWorklet: raw PCM with the exact AudioContext time of the first sample,
// so takes line up with the backing track.

const WORKLET = `
class EncoreRecorder extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.port.onmessage = (e) => { this.on = e.data === 'start' ? true : e.data === 'stop' ? false : this.on; if (e.data === 'stop') this.port.postMessage({ type: 'stopped' }) } }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (this.on && ch) {
      this.port.postMessage({ type: 'data', t: currentTime, d: new Float32Array(ch) })
    }
    return true
  }
}
registerProcessor('encore-recorder', EncoreRecorder)
`

let workletLoaded: Promise<void> | null = null
function ensureWorklet(ctx: AudioContext) {
  if (!workletLoaded) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    workletLoaded = ctx.audioWorklet.addModule(url)
  }
  return workletLoaded
}

export interface MicOptions {
  echoCancellation: boolean
}

export class MicRecorder {
  ctx: AudioContext
  stream: MediaStream | null = null
  source: MediaStreamAudioSourceNode | null = null
  node: AudioWorkletNode | null = null
  analyser: AnalyserNode | null = null
  monitor: GainNode | null = null
  private chunks: Float32Array[] = []
  private firstTime: number | null = null
  private recording = false
  inputLatency = 0

  constructor() {
    this.ctx = audioCtx()
  }

  async open(opts: MicOptions) {
    if (this.stream) return
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot record audio. Try Chrome or Safari over https.')
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: opts.echoCancellation,
        noiseSuppression: opts.echoCancellation,
        autoGainControl: false,
        channelCount: 1,
      },
    })
    await ensureWorklet(this.ctx)
    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, 'encore-recorder', { numberOfInputs: 1, numberOfOutputs: 0 })
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.monitor = this.ctx.createGain()
    this.monitor.gain.value = 0
    this.source.connect(this.node)
    this.source.connect(this.analyser)
    this.source.connect(this.monitor)
    this.monitor.connect(this.ctx.destination)
    const settings = this.stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number }
    this.inputLatency = typeof settings?.latency === 'number' ? settings.latency : 0.01
    this.node.port.onmessage = (e) => {
      const m = e.data as { type: string; t: number; d: Float32Array }
      if (m.type === 'data' && this.recording) {
        if (this.firstTime === null) this.firstTime = m.t
        this.chunks.push(m.d)
      }
    }
  }

  setMonitor(level: number) {
    if (this.monitor) this.monitor.gain.setTargetAtTime(level, this.ctx.currentTime, 0.02)
  }

  start() {
    this.chunks = []
    this.firstTime = null
    this.recording = true
    this.node?.port.postMessage('start')
  }

  /** Stop and return the PCM plus the ctx time of its first sample. */
  stop(): { data: Float32Array; sampleRate: number; firstCtxTime: number } {
    this.recording = false
    this.node?.port.postMessage('stop')
    const n = this.chunks.reduce((a, c) => a + c.length, 0)
    const data = new Float32Array(n)
    let o = 0
    for (const c of this.chunks) {
      data.set(c, o)
      o += c.length
    }
    this.chunks = []
    return { data, sampleRate: this.ctx.sampleRate, firstCtxTime: this.firstTime ?? this.ctx.currentTime }
  }

  get isRecording() {
    return this.recording
  }

  /** total round-trip latency estimate in seconds */
  get roundTripLatency() {
    const out = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0)
    return out + this.inputLatency
  }

  close() {
    this.recording = false
    this.source?.disconnect()
    this.node?.disconnect()
    this.analyser?.disconnect()
    this.monitor?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.source = null
    this.node = null
  }
}

/** Fast autocorrelation pitch estimate for the live pitch meter (Hz, or 0). */
export function livePitch(buf: Float32Array, sampleRate: number): number {
  let rms = 0
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i]
  rms = Math.sqrt(rms / buf.length)
  if (rms < 0.01) return 0
  const minLag = Math.floor(sampleRate / 1000)
  const maxLag = Math.min(buf.length >> 1, Math.floor(sampleRate / 70))
  const n = buf.length - maxLag
  // normalized difference (YIN-lite)
  let best = 0
  let bestVal = 1
  let running = 0
  const d = new Float32Array(maxLag + 1)
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0
    for (let i = 0; i < n; i += 2) {
      const x = buf[i] - buf[i + lag]
      s += x * x
    }
    running += s
    d[lag] = (s * lag) / (running || 1)
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (d[lag] < 0.15) {
      while (lag + 1 <= maxLag && d[lag + 1] < d[lag]) lag++
      best = lag
      bestVal = d[lag]
      break
    }
    if (d[lag] < bestVal) {
      bestVal = d[lag]
      best = lag
    }
  }
  if (!best || bestVal > 0.35) return 0
  // parabolic interpolation
  const a = d[best - 1] ?? d[best]
  const b = d[best]
  const c = d[best + 1] ?? d[best]
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1)
  return sampleRate / (best + (isFinite(shift) ? shift : 0))
}
