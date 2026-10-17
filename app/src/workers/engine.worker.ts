/// <reference lib="webworker" />
import { composeLocal } from '../engines/local'
import { analyzePitch, polishVocal } from '../dsp'
import { encodeMp3 } from '../lib/mp3'
import { detectKey } from '../lib/keydetect'
import type { ComposeRequest, MonoBuffer, StereoBuffer } from '../types'
import type { PitchTrack, PolishParams } from '../dsp'

type Req =
  | { id: number; op: 'compose'; req: ComposeRequest }
  | { id: number; op: 'analyzePitch'; input: MonoBuffer }
  | { id: number; op: 'polish'; input: MonoBuffer; params: PolishParams; mp3?: boolean }
  | { id: number; op: 'encodeMp3'; input: StereoBuffer; kbps?: number }
  | { id: number; op: 'detectKey'; input: MonoBuffer }

const post = (msg: unknown, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer)

function stereoTransfer(s?: StereoBuffer): Transferable[] {
  return s ? [s.left.buffer, s.right.buffer] : []
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const m = ev.data
  const progress = (fraction: number, label: string) => post({ id: m.id, type: 'progress', fraction, label })
  try {
    if (m.op === 'compose') {
      const r = await composeLocal(m.req, (f, l) => progress(f * 0.85, l))
      progress(0.86, 'Encoding audio')
      const mix = encodeMp3(r.mix, 192)
      progress(0.92, 'Encoding stems')
      const inst = encodeMp3(r.instrumental, 192)
      const voc = r.vocals ? encodeMp3(r.vocals, 160) : undefined
      const result = {
        mixMp3: mix,
        instrumentalMp3: inst,
        vocalsMp3: voc,
        melody: r.melody,
        timedLyrics: r.timedLyrics,
        key: r.key,
        bpm: r.bpm,
        durationSec: r.durationSec,
        tags: r.tags,
      }
      const tr: Transferable[] = [mix.buffer, inst.buffer]
      if (voc) tr.push(voc.buffer)
      post({ id: m.id, type: 'done', result }, tr)
    } else if (m.op === 'analyzePitch') {
      const t: PitchTrack = analyzePitch(m.input, progress)
      post({ id: m.id, type: 'done', result: t }, [t.f0.buffer, t.confidence.buffer])
    } else if (m.op === 'polish') {
      const out = polishVocal(m.input, m.params, progress)
      let mp3: Uint8Array | undefined
      if (m.mp3) mp3 = encodeMp3(out, 192)
      post({ id: m.id, type: 'done', result: { out, mp3 } }, [...stereoTransfer(out), ...(mp3 ? [mp3.buffer] : [])])
    } else if (m.op === 'detectKey') {
      post({ id: m.id, type: 'done', result: detectKey(m.input.data, m.input.sampleRate) })
    } else if (m.op === 'encodeMp3') {
      const mp3 = encodeMp3(m.input, m.kbps ?? 192, (f) => progress(f, 'Encoding MP3'))
      post({ id: m.id, type: 'done', result: mp3 }, [mp3.buffer])
    }
  } catch (e) {
    post({ id: m.id, type: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}
