import type { ParsedLyrics } from '../../types'
import type { CloudSongRequest } from './types'

const MINIMAX_TAG: Record<string, string> = {
  Intro: 'Intro',
  Verse: 'Verse',
  'Pre-Chorus': 'Pre Chorus',
  Chorus: 'Chorus',
  'Post-Chorus': 'Chorus',
  Hook: 'Chorus',
  Refrain: 'Chorus',
  Bridge: 'Bridge',
  Breakdown: 'Bridge',
  Interlude: 'Inst',
  Instrumental: 'Inst',
  Solo: 'Inst',
  Drop: 'Inst',
  Build: 'Inst',
  'Build-Up': 'Inst',
  Outro: 'Outro',
  End: 'Outro',
}

/** Lyrics in the bracket format MiniMax / ACE-Step expect: one tag per line, then the lines. */
export function minimaxLyrics(p: ParsedLyrics, maxChars = 3400): string {
  const out: string[] = []
  for (const s of p.sections) {
    const tag = MINIMAX_TAG[s.tag] ?? 'Verse'
    out.push(`[${tag}]`)
    for (const l of s.lines) out.push(l)
    out.push('')
  }
  let txt = out.join('\n').trim()
  if (txt.length > maxChars) txt = txt.slice(0, maxChars).replace(/\n[^\n]*$/, '')
  return txt
}

export function plainLyrics(p: ParsedLyrics): string {
  return p.sections.flatMap((s) => s.lines).join('\n')
}

export function stylePrompt(req: CloudSongRequest, maxChars = 1900): string {
  const parts = [req.style.trim()]
  if (!req.instrumental) {
    if (req.vocalGender === 'female' && !/female/i.test(req.style)) parts.push('female vocals')
    if (req.vocalGender === 'male' && !/\bmale/i.test(req.style)) parts.push('male vocals')
  } else parts.push('instrumental, no vocals')
  if (req.weirdness > 0.75) parts.push('experimental, unexpected twists')
  else if (req.weirdness < 0.2) parts.push('classic, familiar structure')
  if (req.excludeStyle?.trim()) parts.push(`avoid: ${req.excludeStyle.trim()}`)
  if (req.title.trim()) parts.push(`song title: "${req.title.trim()}"`)
  return parts.filter(Boolean).join(', ').slice(0, maxChars)
}

export function splitTags(s: string): string[] {
  return s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12)
}

/** rough seconds per lyric line by section */
export function estimateSectionMs(tag: string, lines: number): number {
  if (tag === 'Intro' || tag === 'Outro' || tag === 'End') return Math.max(6000, lines * 3500)
  if (['Instrumental', 'Interlude', 'Solo', 'Drop', 'Build', 'Build-Up', 'Breakdown'].includes(tag) && lines === 0) return 12000
  return Math.min(120000, Math.max(6000, lines * 4200))
}

export function estimateDurationSec(p: ParsedLyrics, hint?: number): number {
  if (hint) return hint
  const ms = p.sections.reduce((a, s) => a + estimateSectionMs(s.tag, s.lines.length), 0)
  return Math.round(Math.min(240, Math.max(60, ms / 1000 + 12)))
}

export const LYRICS_SYSTEM_PROMPT = `You are a hit songwriter. Write original, singable song lyrics.
Rules:
- Output ONLY JSON: {"title": string, "style": string, "lyrics": string}
- "lyrics" uses section tags on their own lines: [Intro] (optional, no lines), [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Outro].
- 2 verses of 4-6 lines, a memorable repeated chorus of 4 lines (repeat it 2-3 times), a bridge of 2-4 lines.
- Lines 5-11 syllables, strong rhymes, vivid concrete imagery, conversational. No clichés like "fire in my soul".
- Backing vocals/ad-libs in (parentheses) sparingly.
- "style" is a comma-separated music style prompt (genre, mood, instruments, tempo, vocal type) under 180 characters.
- Never copy existing copyrighted lyrics or imitate a named living artist.`
