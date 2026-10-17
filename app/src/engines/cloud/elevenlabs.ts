import type { TimedWord } from '../../types'
import { unzip } from '../../lib/unzip'
import { ApiError, readError, withProxy } from './http'
import { estimateDurationSec, estimateSectionMs, splitTags, stylePrompt } from './format'
import type { CloudCtx, CloudProvider, CloudSongRequest, RemoteAudio } from './types'

// ElevenLabs direct API (xi-api-key). Music returns word timestamps with the song.

const API = 'https://api.elevenlabs.io'

function headers(ctx: CloudCtx, json = true): Record<string, string> {
  const h: Record<string, string> = { 'xi-api-key': ctx.key }
  if (json) h['Content-Type'] = 'application/json'
  return h
}

async function post(path: string, ctx: CloudCtx, body: BodyInit, json = true): Promise<Response> {
  const res = await fetch(withProxy(API + path, ctx.proxy), { method: 'POST', headers: headers(ctx, json), body, signal: ctx.signal })
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return res
}

function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/** Parse a multipart/mixed body into parts {headers, body}. */
export function parseMultipart(buf: Uint8Array, boundary: string): { headers: Record<string, string>; body: Uint8Array }[] {
  const enc = new TextEncoder()
  const delim = enc.encode(`--${boundary}`)
  const parts: { headers: Record<string, string>; body: Uint8Array }[] = []
  let pos = indexOf(buf, delim)
  while (pos >= 0) {
    let start = pos + delim.length
    if (buf[start] === 45 && buf[start + 1] === 45) break // closing --
    if (buf[start] === 13) start += 2
    else if (buf[start] === 10) start += 1
    const next = indexOf(buf, delim, start)
    if (next < 0) break
    let end = next
    if (buf[end - 1] === 10) end--
    if (buf[end - 1] === 13) end--
    const part = buf.subarray(start, end)
    let sep = indexOf(part, enc.encode('\r\n\r\n'))
    let sepLen = 4
    if (sep < 0) {
      sep = indexOf(part, enc.encode('\n\n'))
      sepLen = 2
    }
    const head = new TextDecoder().decode(part.subarray(0, Math.max(0, sep)))
    const hs: Record<string, string> = {}
    for (const line of head.split(/\r?\n/)) {
      const i = line.indexOf(':')
      if (i > 0) hs[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
    }
    parts.push({ headers: hs, body: part.subarray(sep + sepLen) })
    pos = next
  }
  return parts
}

async function generateSong(req: CloudSongRequest, ctx: CloudCtx) {
  const modelId = req.model || 'music_v1'
  const dur = estimateDurationSec(req.lyrics, req.durationHint)
  const positive = splitTags(req.style)
  const negative = splitTags(req.excludeStyle ?? '')
  let body: Record<string, unknown>
  if (req.instrumental || !req.lyrics.sections.length) {
    body = { prompt: stylePrompt(req), music_length_ms: Math.round(dur * 1000), model_id: modelId, force_instrumental: req.instrumental }
  } else if (modelId === 'music_v1') {
    body = {
      model_id: modelId,
      composition_plan: {
        positive_global_styles: positive.length ? positive : [req.style.slice(0, 120)],
        negative_global_styles: negative,
        sections: req.lyrics.sections.map((s) => ({
          section_name: s.label,
          positive_local_styles: [],
          negative_local_styles: [],
          duration_ms: Math.round(estimateSectionMs(s.tag, s.lines.length)),
          lines: s.lines.slice(0, 30).map((l) => l.slice(0, 200)),
        })),
      },
    }
  } else {
    body = {
      model_id: modelId,
      seed: req.seed % 2147483647,
      composition_plan: {
        chunks: req.lyrics.sections.map((s) => ({
          text: `[${s.label}]\n${s.lines.join('\n')}`,
          duration_ms: Math.round(estimateSectionMs(s.tag, s.lines.length)),
          positive_styles: positive.length ? positive : [req.style.slice(0, 120)],
          negative_styles: negative,
        })),
      },
    }
  }
  ctx.onProgress?.(0.1, 'Composing')
  const tick = setInterval(() => ctx.onProgress?.(0.5, 'Composing'), 5000)
  try {
    const res = await post('/v1/music/detailed?output_format=mp3_44100_192', ctx, JSON.stringify({ ...body, with_timestamps: true }))
    const ct = res.headers.get('content-type') ?? ''
    const buf = new Uint8Array(await res.arrayBuffer())
    const bm = ct.match(/boundary="?([^";]+)"?/)
    let audio: Blob | null = null
    let words: TimedWord[] | undefined
    let title: string | undefined
    let tags: string[] | undefined
    if (bm) {
      for (const p of parseMultipart(buf, bm[1])) {
        const pct = p.headers['content-type'] ?? ''
        if (pct.includes('json')) {
          try {
            const j = JSON.parse(new TextDecoder().decode(p.body))
            const wt = j.words_timestamps ?? j.song_metadata?.words_timestamps
            if (Array.isArray(wt))
              words = wt
                .map((w: { word?: string; text?: string; start_ms: number; end_ms: number }) => ({
                  text: String(w.word ?? w.text ?? '').trim(),
                  start: w.start_ms / 1000,
                  end: w.end_ms / 1000,
                }))
                .filter((w: TimedWord) => w.text)
            title = j.song_metadata?.title
            if (Array.isArray(j.song_metadata?.genres)) tags = j.song_metadata.genres
          } catch {
            /* ignore metadata errors */
          }
        } else if (p.body.length > 1000) audio = new Blob([p.body.slice()], { type: pct || 'audio/mpeg' })
      }
    } else audio = new Blob([buf], { type: ct || 'audio/mpeg' })
    if (!audio) throw new Error('No audio in response')
    return { audio: { blob: audio } as RemoteAudio, words, title, tags: tags ?? positive }
  } finally {
    clearInterval(tick)
  }
}

export const elevenLabsProvider: CloudProvider = {
  id: 'elevenlabs',
  label: 'ElevenLabs',
  keyHelp: 'ElevenLabs Music gives polished songs and returns word-by-word lyric timing. Needs a paid ElevenLabs plan for music.',
  keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
  models: [
    { id: 'music_v1', label: 'ElevenLabs Music v1', description: 'Section-by-section composition plan', badge: 'v1' },
    { id: 'music_v2_5', label: 'ElevenLabs Music v2.5', description: 'Latest ElevenLabs music model', badge: 'v2.5' },
  ],
  generateSong,
  async separateStems(audio, ctx) {
    const fd = new FormData()
    fd.append('file', audio.blob, 'song.mp3')
    fd.append('stem_variation_id', 'two_stems_v1')
    ctx.onProgress?.(0.2, 'Separating vocals')
    const res = await post('/v1/music/stem-separation?output_format=mp3_44100_192', ctx, fd, false)
    const files = await unzip(await res.arrayBuffer())
    const voc = files.find((f) => /vocal/i.test(f.name) && !/no[_-]?vocal|instrument/i.test(f.name))
    const inst = files.filter((f) => f !== voc)
    if (!voc || !inst.length) throw new Error('Stem separation returned unexpected files')
    const mk = (d: Uint8Array): RemoteAudio => ({ blob: new Blob([d as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' }) })
    return { vocals: mk(voc.data), instrumental: inst.map((f) => mk(f.data)) }
  },
  async alignWords(vocals, text, ctx) {
    const fd = new FormData()
    fd.append('file', vocals.blob, 'vocals.mp3')
    fd.append('text', text)
    ctx.onProgress?.(0.5, 'Timing lyrics')
    const res = await post('/v1/forced-alignment', ctx, fd, false)
    const j = (await res.json()) as { words?: { text: string; start: number; end: number }[] }
    return (j.words ?? []).filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }))
  },
  async transcribeWords(vocals, ctx) {
    const fd = new FormData()
    fd.append('file', vocals.blob, 'vocals.mp3')
    fd.append('model_id', 'scribe_v2')
    fd.append('timestamps_granularity', 'word')
    fd.append('tag_audio_events', 'false')
    const res = await post('/v1/speech-to-text', ctx, fd, false)
    const j = (await res.json()) as { words?: { text: string; start: number; end: number; type?: string }[] }
    return (j.words ?? []).filter((w) => (w.type ?? 'word') === 'word').map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }))
  },
  async writeLyrics(prompt, style, ctx) {
    const res = await post('/v1/music/plan', ctx, JSON.stringify({ prompt: `${prompt}${style ? `. Style: ${style}` : ''}`, music_length_ms: 150000, model_id: 'music_v1' }))
    const plan = (await res.json()) as {
      sections?: { section_name: string; lines: string[] }[]
      chunks?: { text: string }[]
      positive_global_styles?: string[]
    }
    let lyrics = ''
    if (plan.sections) lyrics = plan.sections.map((s) => `[${s.section_name}]\n${(s.lines ?? []).join('\n')}`).join('\n\n')
    else if (plan.chunks) lyrics = plan.chunks.map((c) => c.text).join('\n\n')
    const first = lyrics.split('\n').find((l) => l && !l.startsWith('['))
    return { title: first ? first.replace(/[,.!?]/g, '').split(' ').slice(0, 4).join(' ') : 'Untitled', lyrics, style: plan.positive_global_styles?.join(', ') }
  },
  async testKey(ctx) {
    const res = await fetch(withProxy(`${API}/v1/user`, ctx.proxy), { headers: headers(ctx, false) })
    if (!res.ok) throw new ApiError(await readError(res), res.status)
  },
}
