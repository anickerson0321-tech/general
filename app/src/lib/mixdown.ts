import type { StereoBuffer } from '../types'
import { resampleLinear } from './audio'

export interface MixSource {
  left: Float32Array
  right: Float32Array
  sampleRate: number
  offsetSec: number
  gain: number
  pan?: number // -1..1
}

/** Offline mix of several stereo sources onto one timeline, with a soft-knee bus limiter. */
export function mixdown(sources: MixSource[], sampleRate: number, lengthSec?: number): StereoBuffer {
  let end = 0
  for (const s of sources) end = Math.max(end, s.offsetSec + s.left.length / s.sampleRate)
  const n = Math.ceil((lengthSec ?? end) * sampleRate)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  for (const s of sources) {
    if (s.gain <= 0) continue
    const l = s.sampleRate === sampleRate ? s.left : resampleLinear(s.left, s.sampleRate, sampleRate)
    const r = s.right === s.left ? l : s.sampleRate === sampleRate ? s.right : resampleLinear(s.right, s.sampleRate, sampleRate)
    const pan = s.pan ?? 0
    const gl = s.gain * Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2
    const gr = s.gain * Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2
    const off = Math.round(s.offsetSec * sampleRate)
    for (let i = 0; i < l.length; i++) {
      const j = i + off
      if (j < 0) continue
      if (j >= n) break
      L[j] += l[i] * gl
      R[j] += r[i] * gr
    }
  }
  // gentle look-ahead-free limiter: envelope follower + soft clip
  let env = 0
  const ceiling = 0.94
  const rel = Math.exp(-1 / (0.15 * sampleRate))
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]))
    env = a > env ? a : env * rel + a * (1 - rel)
    const g = env > ceiling ? ceiling / env : 1
    L[i] = Math.tanh(L[i] * g * 1.02) / Math.tanh(1.02)
    R[i] = Math.tanh(R[i] * g * 1.02) / Math.tanh(1.02)
  }
  return { sampleRate, left: L, right: R }
}

export function bufferToSource(b: AudioBuffer, offsetSec: number, gain: number, pan = 0): MixSource {
  const left = b.getChannelData(0)
  const right = b.numberOfChannels > 1 ? b.getChannelData(1) : left
  return { left, right, sampleRate: b.sampleRate, offsetSec, gain, pan }
}
