import type { TimedWord } from '../../types'
import { ApiError, blobToDataUri, fetchBlob, readError, sleep, withProxy } from './http'
import { LYRICS_SYSTEM_PROMPT, estimateDurationSec, estimateSectionMs, minimaxLyrics, plainLyrics, splitTags, stylePrompt } from './format'
import type { CloudCtx, CloudProvider, CloudSongRequest, RemoteAudio } from './types'

// fal.ai — one key for songs, stems, lyric timing and lyric writing.
// Queue API: POST https://queue.fal.run/<endpoint> -> {request_id, status_url, response_url}

interface FalFile {
  url: string
  content_type?: string
}

const LLM_MODELS = ['anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash', 'openai/gpt-4o-mini']

async function falRun<T>(endpoint: string, input: Record<string, unknown>, ctx: CloudCtx, label: string, base = 0, span = 1): Promise<T> {
  const headers = { Authorization: `Key ${ctx.key}`, 'Content-Type': 'application/json' }
  const submit = await fetch(withProxy(`https://queue.fal.run/${endpoint}`, ctx.proxy), {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
    signal: ctx.signal,
  })
  if (!submit.ok) throw new ApiError(await readError(submit), submit.status)
  const job = (await submit.json()) as { request_id: string; status_url?: string; response_url?: string }
  const [owner, alias] = endpoint.split('/')
  const statusUrl = job.status_url ?? `https://queue.fal.run/${owner}/${alias}/requests/${job.request_id}/status`
  const responseUrl = job.response_url ?? `https://queue.fal.run/${owner}/${alias}/requests/${job.request_id}`
  const t0 = Date.now()
  let delay = 1200
  for (;;) {
    await sleep(delay, ctx.signal)
    delay = Math.min(4000, delay * 1.25)
    const st = await fetch(withProxy(statusUrl, ctx.proxy), { headers, signal: ctx.signal })
    if (!st.ok) throw new ApiError(await readError(st), st.status)
    const s = (await st.json()) as { status: string; queue_position?: number }
    const elapsed = (Date.now() - t0) / 1000
    // asymptotic fake progress while we wait (providers don't report real progress)
    const f = 1 - Math.exp(-elapsed / 45)
    if (s.status === 'IN_QUEUE') ctx.onProgress?.(base + span * f * 0.3, `${label} · in queue${s.queue_position ? ` (#${s.queue_position + 1})` : ''}`)
    else if (s.status === 'IN_PROGRESS') ctx.onProgress?.(base + span * (0.1 + f * 0.85), label)
    else if (s.status === 'COMPLETED') break
    if (elapsed > 900) throw new Error(`${label} timed out`)
  }
  const res = await fetch(withProxy(responseUrl, ctx.proxy), { headers, signal: ctx.signal })
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return (await res.json()) as T
}

async function urlFor(a: RemoteAudio): Promise<string> {
  // fal accepts data URIs for file inputs; prefer the hosted URL when we have one
  return a.url ?? blobToDataUri(a.blob)
}

async function toRemote(f: FalFile | undefined, ctx: CloudCtx): Promise<RemoteAudio> {
  if (!f?.url) throw new Error('Provider returned no audio')
  return { url: f.url, blob: await fetchBlob(f.url, ctx.proxy) }
}

async function generateSong(req: CloudSongRequest, ctx: CloudCtx) {
  const style = stylePrompt(req)
  const lyr = minimaxLyrics(req.lyrics)
  const dur = estimateDurationSec(req.lyrics, req.durationHint)
  let model = req.model
  if (req.instrumental && (model === 'minimax/music-3' || model === 'fal-ai/ace-step')) model = 'fal-ai/minimax-music/v2.6'
  let out: { audio?: FalFile; audio_file?: FalFile }
  const label = 'Composing'
  if (model.startsWith('elevenlabs/') || model.startsWith('fal-ai/elevenlabs')) {
    const negative = splitTags(req.excludeStyle ?? '')
    const positive = splitTags(req.style)
    if (req.instrumental || !req.lyrics.sections.length) {
      out = await falRun(model, {
        prompt: style,
        music_length_ms: Math.round(dur * 1000),
        force_instrumental: req.instrumental,
        seed: req.seed % 2147483647,
      }, ctx, label)
    } else {
      const chunks = req.lyrics.sections.map((s) => ({
        text: `[${s.label}]\n${s.lines.join('\n')}`.trim(),
        duration_ms: Math.round(estimateSectionMs(s.tag, s.lines.length)),
        positive_styles: positive.length ? positive : [req.style.slice(0, 120)],
        negative_styles: negative,
      }))
      out = await falRun(model, { composition_plan: { chunks }, seed: req.seed % 2147483647 }, ctx, label)
    }
  } else if (model === 'fal-ai/ace-step') {
    out = await falRun(model, { tags: style.slice(0, 500), lyrics: lyr, duration: dur, seed: req.seed % 2147483647 }, ctx, label)
  } else if (model === 'minimax/music-3') {
    out = await falRun(model, { prompt: style, lyrics: lyr, duration: dur, seed: req.seed % 2147483647 }, ctx, label)
  } else {
    // MiniMax 2.x family
    const input: Record<string, unknown> = {
      prompt: style.slice(0, 2000),
      audio_setting: { format: 'mp3', sample_rate: 44100, bitrate: 256000 },
    }
    if (req.instrumental) input.is_instrumental = true
    else if (lyr) input.lyrics = lyr
    else input.lyrics_optimizer = true
    out = await falRun(model, input, ctx, label)
  }
  const audio = await toRemote(out.audio ?? out.audio_file, ctx)
  return { audio, tags: splitTags(req.style) }
}

export const falProvider: CloudProvider = {
  id: 'fal',
  label: 'fal.ai',
  keyHelp: 'One key unlocks real AI songs with vocals (MiniMax, ElevenLabs Music, ACE-Step), vocal/instrumental splitting, karaoke word timing and AI lyrics. Pay-as-you-go, no subscription.',
  keyUrl: 'https://fal.ai/dashboard/keys',
  models: [
    { id: 'minimax/music-3', label: 'MiniMax Music 3', description: 'Newest MiniMax — full songs with expressive vocals', badge: 'v3' },
    { id: 'elevenlabs/music/v2.5', label: 'ElevenLabs Music v2.5', description: 'Studio-grade mixes, section-by-section control', badge: 'v2.5' },
    { id: 'fal-ai/minimax-music/v2.6', label: 'MiniMax Music 2.6', description: 'Fast and cheap, great pop/rap vocals', badge: 'v2.6' },
    { id: 'fal-ai/ace-step', label: 'ACE-Step (open model)', description: 'Open-source song model, very cheap', badge: 'open' },
  ],
  generateSong,
  async separateStems(audio, ctx) {
    const out = await falRun<Record<string, FalFile | undefined>>(
      'fal-ai/demucs',
      { audio_url: await urlFor(audio), model: 'htdemucs', stems: ['vocals', 'drums', 'bass', 'other'], output_format: 'mp3' },
      ctx,
      'Separating vocals',
    )
    const vocals = await toRemote(out.vocals, ctx)
    const inst: RemoteAudio[] = []
    for (const k of ['drums', 'bass', 'other', 'guitar', 'piano']) if (out[k]?.url) inst.push(await toRemote(out[k], ctx))
    if (!inst.length) throw new Error('Stem separation returned no instrumental stems')
    return { vocals, instrumental: inst }
  },
  async alignWords(vocals, text, ctx) {
    const out = await falRun<{ words?: { text: string; start: number; end: number }[] }>(
      'fal-ai/elevenlabs/forced-alignment',
      { audio_url: await urlFor(vocals), text },
      ctx,
      'Timing lyrics',
    )
    return (out.words ?? []).filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }))
  },
  async transcribeWords(vocals, ctx) {
    const out = await falRun<{ words?: { text: string; start: number; end: number; type?: string }[] }>(
      'fal-ai/elevenlabs/speech-to-text/scribe-v2',
      { audio_url: await urlFor(vocals), tag_audio_events: false },
      ctx,
      'Listening to lyrics',
    )
    return (out.words ?? [])
      .filter((w) => (w.type ?? 'word') === 'word' && w.text.trim())
      .map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }))
  },
  async writeLyrics(prompt, style, ctx) {
    let lastErr: unknown
    for (const model of LLM_MODELS) {
      try {
        const out = await falRun<{ output?: string }>(
          'openrouter/router',
          {
            model,
            system_prompt: LYRICS_SYSTEM_PROMPT,
            prompt: `Song idea: ${prompt || 'surprise me'}\n${style ? `Style: ${style}` : ''}`,
            temperature: 0.9,
            max_tokens: 1400,
          },
          ctx,
          'Writing lyrics',
        )
        return parseLyricsJson(out.output ?? '')
      } catch (e) {
        lastErr = e
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) throw e
      }
    }
    throw lastErr
  },
  async testKey(ctx) {
    // a cheap call: an LLM ping
    const res = await fetch(withProxy('https://queue.fal.run/openrouter/router', ctx.proxy), {
      method: 'POST',
      headers: { Authorization: `Key ${ctx.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: LLM_MODELS[1], prompt: 'Say OK', max_tokens: 5 }),
    })
    if (!res.ok) throw new ApiError(await readError(res), res.status)
  },
}

export function parseLyricsJson(text: string): { title: string; lyrics: string; style?: string } {
  const m = text.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      const j = JSON.parse(m[0])
      if (typeof j.lyrics === 'string') return { title: String(j.title ?? '').slice(0, 80), lyrics: j.lyrics, style: j.style ? String(j.style) : undefined }
    } catch {
      /* fall through */
    }
  }
  // plain text fallback
  const lines = text.trim().split('\n')
  const title = lines[0]?.replace(/^title:\s*/i, '').replace(/["#*]/g, '').slice(0, 80) || 'Untitled'
  return { title, lyrics: lines.slice(1).join('\n').trim() || text }
}

export type { TimedWord }
export { plainLyrics }
