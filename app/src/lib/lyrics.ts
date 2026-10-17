import type { LyricSection, ParsedLyrics, TimedLine } from '../types'

const KNOWN_TAGS = [
  'Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Post-Chorus', 'Hook', 'Bridge', 'Breakdown',
  'Drop', 'Build', 'Build-Up', 'Interlude', 'Instrumental', 'Solo', 'Refrain', 'Outro', 'End',
]

function normalizeTag(raw: string): string {
  const t = raw.trim().replace(/\s+\d+$/, '').toLowerCase()
  const hit = KNOWN_TAGS.find((k) => k.toLowerCase() === t)
  if (hit) return hit
  if (t.startsWith('pre')) return 'Pre-Chorus'
  if (t.includes('chorus')) return 'Chorus'
  if (t.includes('verse')) return 'Verse'
  if (t.includes('bridge')) return 'Bridge'
  if (t.includes('intro')) return 'Intro'
  if (t.includes('outro') || t.includes('end')) return 'Outro'
  if (t.includes('instrumental') || t.includes('solo') || t.includes('break')) return 'Instrumental'
  if (t.includes('hook')) return 'Hook'
  return raw.trim().replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Parse Suno-style lyrics: lines inside [Section] blocks. Text in (parentheses) is kept
 * (backing vocals). Lines that are only meta instructions like [fade out] become their own
 * section only if they look like a section tag.
 */
export function parseLyrics(text: string): ParsedLyrics {
  const sections: LyricSection[] = []
  let current: LyricSection | null = null
  const counts: Record<string, number> = {}
  const push = (tag: string, explicitLabel?: string) => {
    counts[tag] = (counts[tag] ?? 0) + 1
    const label = explicitLabel ?? (['Verse'].includes(tag) ? `${tag} ${counts[tag]}` : tag)
    current = { tag, label, lines: [] }
    sections.push(current)
  }
  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const m = line.match(/^\[([^\]]+)\]$/)
    if (m) {
      const inner = m[1].split(':')[0]
      const tag = normalizeTag(inner)
      const numbered = inner.trim().match(/^(.*?)(\d+)$/)
      push(tag, numbered ? `${tag} ${numbered[2]}` : undefined)
      continue
    }
    // strip inline tags like [whispered]
    const cleaned = line.replace(/\[[^\]]*\]/g, '').trim()
    if (!cleaned) continue
    if (!current) push('Verse')
    current!.lines.push(cleaned)
  }
  return { sections }
}

export function lyricsToText(p: ParsedLyrics): string {
  return p.sections
    .map((s) => `[${s.label}]\n${s.lines.join('\n')}`)
    .join('\n\n')
}

export function countSungLines(p: ParsedLyrics): number {
  return p.sections.reduce((n, s) => n + s.lines.length, 0)
}

/** Words of a lyric line for display/timing (keeps punctuation attached). */
export function splitWords(line: string): string[] {
  return line.split(/\s+/).filter(Boolean)
}

/** Find the index of the active line at time t (or -1). */
export function activeLineIndex(lines: TimedLine[], t: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].start <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}
