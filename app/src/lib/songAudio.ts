import type { Song, Take } from '../state/models'
import type { MonoBuffer, StereoBuffer, MelodyNote } from '../types'
import type { PitchTrack } from '../dsp'
import { getBlob, putBlob } from './db'
import { decodeBlob, parseWavMono, audioBufferToMono, resampleLinear } from './audio'
import { analyzePitchInWorker } from '../workers/client'
import { uid } from './id'
import { useApp } from '../state/store'

// Decoded-audio caches shared by Karaoke, Take editor and Studio.

const decoded = new Map<string, Promise<AudioBuffer>>()
export function loadBuffer(key: string | undefined): Promise<AudioBuffer | null> {
  if (!key) return Promise.resolve(null)
  let p = decoded.get(key)
  if (!p) {
    p = getBlob(key).then((b) => {
      if (!b) throw new Error('Audio missing from storage')
      return decodeBlob(b)
    })
    decoded.set(key, p)
    p.catch(() => decoded.delete(key))
    if (decoded.size > 12) decoded.delete(decoded.keys().next().value as string)
  }
  return p
}

const rawTakes = new Map<string, Promise<MonoBuffer>>()
export function loadTakeRaw(take: Take): Promise<MonoBuffer> {
  let p = rawTakes.get(take.rawKey)
  if (!p) {
    p = getBlob(take.rawKey).then(async (b) => {
      if (!b) throw new Error('Take audio missing')
      return (await parseWavMono(b)) ?? audioBufferToMono(await decodeBlob(b))
    })
    rawTakes.set(take.rawKey, p)
    p.catch(() => rawTakes.delete(take.rawKey))
  }
  return p
}

const takeAnalysis = new Map<string, Promise<PitchTrack>>()
export function analyzeTake(take: Take): Promise<PitchTrack> {
  let p = takeAnalysis.get(take.rawKey)
  if (!p) {
    p = loadTakeRaw(take).then((m) => analyzePitchInWorker(m))
    takeAnalysis.set(take.rawKey, p)
    p.catch(() => takeAnalysis.delete(take.rawKey))
  }
  return p
}

interface StoredTrack {
  sampleRate: number
  hopSec: number
  f0: number[]
  confidence: number[]
}

const guideCache = new Map<string, Promise<PitchTrack | null>>()
/** Pitch track of the song's guide vocal (AI singer), used to tune the user toward the real melody. */
export function guidePitch(song: Song): Promise<PitchTrack | null> {
  if (!song.vocalsKey) return Promise.resolve(null)
  const ck = song.vocalsKey
  let p = guideCache.get(ck)
  if (!p) {
    p = (async () => {
      if (song.guidePitchKey) {
        const b = await getBlob(song.guidePitchKey)
        if (b) {
          const j = JSON.parse(await b.text()) as StoredTrack
          return { sampleRate: j.sampleRate, hopSec: j.hopSec, f0: Float32Array.from(j.f0), confidence: Float32Array.from(j.confidence) }
        }
      }
      const buf = await loadBuffer(song.vocalsKey)
      if (!buf) return null
      let mono = audioBufferToMono(buf)
      if (mono.sampleRate > 24000) mono = { sampleRate: mono.sampleRate / 2, data: resampleLinear(mono.data, mono.sampleRate, mono.sampleRate / 2) }
      const t = await analyzePitchInWorker(mono)
      const key = uid('g')
      const st: StoredTrack = { sampleRate: t.sampleRate, hopSec: t.hopSec, f0: Array.from(t.f0, (x) => Math.round(x * 10) / 10), confidence: Array.from(t.confidence, (x) => Math.round(x * 100) / 100) }
      await putBlob(key, new Blob([JSON.stringify(st)], { type: 'application/json' }))
      useApp.getState().patchSong(song.id, { guidePitchKey: key })
      return t
    })()
    guideCache.set(ck, p)
    p.catch(() => guideCache.delete(ck))
  }
  return p
}

/** The target pitch (midi) at song time t, from the melody or guide track. 0 if none. */
export function targetMidiAt(t: number, melody?: MelodyNote[], guide?: PitchTrack | null): number {
  if (melody?.length) {
    let lo = 0
    let hi = melody.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const n = melody[mid]
      if (t < n.start) hi = mid - 1
      else if (t >= n.end) lo = mid + 1
      else return n.midi
    }
    return 0
  }
  if (guide) {
    const i = Math.round(t / guide.hopSec)
    const f = guide.f0[i]
    if (f > 0 && guide.confidence[i] > 0.5) return 69 + 12 * Math.log2(f / 440)
  }
  return 0
}

export const hzToMidi = (f: number) => 69 + 12 * Math.log2(f / 440)

/** Fraction of voiced frames within `tol` semitones of the target (octave-folded). */
export function pitchAccuracy(track: PitchTrack, offsetSec: number, melody?: MelodyNote[], guide?: PitchTrack | null, tol = 0.5): { score: number; frames: number } {
  let hit = 0
  let n = 0
  for (let i = 0; i < track.f0.length; i++) {
    const f = track.f0[i]
    if (f <= 0 || track.confidence[i] < 0.5) continue
    const t = offsetSec + i * track.hopSec
    const target = targetMidiAt(t, melody, guide)
    if (!target) continue
    let d = hzToMidi(f) - target
    d -= 12 * Math.round(d / 12)
    n++
    if (Math.abs(d) <= tol) hit++
  }
  return { score: n ? hit / n : 0, frames: n }
}

export function stereoFromMono(m: MonoBuffer): StereoBuffer {
  return { sampleRate: m.sampleRate, left: m.data, right: m.data }
}
