import type { MonoBuffer, StereoBuffer } from '../types'

let ctx: AudioContext | null = null

/** One shared AudioContext for the app. Call from a user gesture at least once on iOS. */
export function audioCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' })
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const ab = await blob.arrayBuffer()
  return audioCtx().decodeAudioData(ab)
}

export function audioBufferToStereo(b: AudioBuffer): StereoBuffer {
  const left = new Float32Array(b.getChannelData(0))
  const right = b.numberOfChannels > 1 ? new Float32Array(b.getChannelData(1)) : new Float32Array(left)
  return { sampleRate: b.sampleRate, left, right }
}

export function audioBufferToMono(b: AudioBuffer): MonoBuffer {
  const out = new Float32Array(b.length)
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c)
    for (let i = 0; i < d.length; i++) out[i] += d[i] / b.numberOfChannels
  }
  return { sampleRate: b.sampleRate, data: out }
}

export function stereoToAudioBuffer(s: StereoBuffer): AudioBuffer {
  const b = audioCtx().createBuffer(2, s.left.length, s.sampleRate)
  b.copyToChannel(s.left as Float32Array<ArrayBuffer>, 0)
  b.copyToChannel(s.right as Float32Array<ArrayBuffer>, 1)
  return b
}

export function monoToAudioBuffer(m: MonoBuffer): AudioBuffer {
  const b = audioCtx().createBuffer(1, m.data.length, m.sampleRate)
  b.copyToChannel(m.data as Float32Array<ArrayBuffer>, 0)
  return b
}

/** 16-bit PCM WAV */
export function encodeWav(buf: StereoBuffer | MonoBuffer): Blob {
  const chans: Float32Array[] = 'data' in buf ? [buf.data] : [buf.left, buf.right]
  const n = chans[0].length
  const nc = chans.length
  const bytes = 44 + n * nc * 2
  const ab = new ArrayBuffer(bytes)
  const v = new DataView(ab)
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  w(0, 'RIFF')
  v.setUint32(4, bytes - 8, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, nc, true)
  v.setUint32(24, buf.sampleRate, true)
  v.setUint32(28, buf.sampleRate * nc * 2, true)
  v.setUint16(32, nc * 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, n * nc * 2, true)
  let o = 44
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]))
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      o += 2
    }
  }
  return new Blob([ab], { type: 'audio/wav' })
}

/** Fast parse of a 16-bit PCM WAV that we wrote ourselves (avoids resampling by decodeAudioData). */
export async function parseWavMono(blob: Blob): Promise<MonoBuffer | null> {
  const ab = await blob.arrayBuffer()
  const v = new DataView(ab)
  if (ab.byteLength < 44 || v.getUint32(0, false) !== 0x52494646) return null
  let off = 12
  let sr = 0
  let nc = 1
  let bits = 16
  while (off + 8 <= ab.byteLength) {
    const id = v.getUint32(off, false)
    const size = v.getUint32(off + 4, true)
    if (id === 0x666d7420) {
      nc = v.getUint16(off + 10, true)
      sr = v.getUint32(off + 12, true)
      bits = v.getUint16(off + 22, true)
    } else if (id === 0x64617461) {
      if (bits !== 16) return null
      const frames = Math.floor(size / (2 * nc))
      const out = new Float32Array(frames)
      let p = off + 8
      for (let i = 0; i < frames; i++) {
        let s = 0
        for (let c = 0; c < nc; c++) {
          s += v.getInt16(p, true) / 32768
          p += 2
        }
        out[i] = s / nc
      }
      return { sampleRate: sr, data: out }
    }
    off += 8 + size + (size & 1)
  }
  return null
}

export function peak(buf: Float32Array): number {
  let p = 0
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i])
    if (a > p) p = a
  }
  return p
}

/** Downsampled min/max envelope for drawing waveforms. */
export function waveformPeaks(chans: Float32Array[], buckets: number): Float32Array {
  const n = chans[0].length
  const out = new Float32Array(buckets)
  const step = n / buckets
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor(b * step)
    const e = Math.min(n, Math.floor((b + 1) * step))
    let m = 0
    for (const ch of chans) {
      for (let i = s; i < e; i += 4) {
        const a = Math.abs(ch[i])
        if (a > m) m = a
      }
    }
    out[b] = m
  }
  return out
}

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Linear resample (good enough for analysis and alignment). */
export function resampleLinear(data: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return data
  const ratio = from / to
  const n = Math.floor(data.length / ratio)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = i * ratio
    const i0 = Math.floor(x)
    const f = x - i0
    const a = data[i0] ?? 0
    const b = data[i0 + 1] ?? a
    out[i] = a + (b - a) * f
  }
  return out
}
