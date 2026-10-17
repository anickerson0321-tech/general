// English syllabification + rough letter-to-sound rules for the singing synth.
//
// syllabify(word)      -> orthographic syllables ("beautiful" -> ["beau","ti","ful"])
// wordPhones(word)     -> per-syllable phones {onset, vowels, coda, stress}

export type Vowel = 'i' | 'I' | 'e' | 'ae' | 'a' | 'o' | 'U' | 'u' | 'A' | 'R' | '@'
export type Cons =
  | 'p' | 'b' | 't' | 'd' | 'k' | 'g' | 'f' | 'v' | 'th' | 'dh' | 's' | 'z' | 'sh' | 'zh' | 'h'
  | 'ch' | 'j' | 'm' | 'n' | 'ng' | 'l' | 'r' | 'w' | 'y'

export interface SylPhones {
  text: string
  onset: Cons[]
  /** vowel targets in order (diphthongs / r-colouring = several) */
  vowels: Vowel[]
  coda: Cons[]
  /** 0 unstressed, 1 secondary/function word, 2 primary */
  stress: number
}

const VOWEL_TOKENS: Record<string, Vowel[]> = {
  i: ['i'], I: ['I'], e: ['e'], ae: ['ae'], a: ['a'], o: ['o'], U: ['U'], u: ['u'], A: ['A'], R: ['R'], '@': ['@'],
  eI: ['e', 'i'], aI: ['a', 'i'], oU: ['o', 'u'], aU: ['a', 'u'], oI: ['o', 'i'],
}
const CONS_SET = new Set(['p', 'b', 't', 'd', 'k', 'g', 'f', 'v', 'th', 'dh', 's', 'z', 'sh', 'zh', 'h', 'ch', 'j', 'm', 'n', 'ng', 'l', 'r', 'w', 'y'])

// Hand-written pronunciations of very common lyric words. Syllables separated by "|",
// phones by spaces, "'" marks the stressed syllable of multi-syllable words.
const DICT: Record<string, string> = {
  i: 'aI', "i'm": 'aI m', "i'll": 'aI l', "i've": 'aI v', "i'd": 'aI d', me: 'm i', my: 'm aI', mine: 'm aI n',
  you: 'y u', your: 'y o r', "you're": 'y o r', "you'll": 'y u l', yours: 'y o r z', the: 'dh @', a: '@', an: '@ n',
  to: 't u', do: 'd u', who: 'h u', two: 't u', too: 't u', into: "'I n | t u", love: 'l A v', heart: 'h a r t',
  come: 'k A m', some: 's A m', one: 'w A n', done: 'd A n', none: 'n A n', gone: 'g o n', give: 'g I v', live: 'l I v',
  have: 'h ae v', are: 'a r', were: 'w R', there: 'dh e r', where: 'w e r', their: 'dh e r', "they're": 'dh e r',
  they: 'dh eI', eyes: 'aI z', eye: 'aI', fire: 'f aI r', again: "@ | 'g e n", away: "@ | 'w eI", alone: "@ | 'l oU n",
  only: "'oU n | l i", every: "'e v | r i", heaven: "'h e v | @ n", forever: "f @ r | 'e v | R", never: "'n e v | R",
  ever: "'e v | R", world: 'w R l d', word: 'w R d', work: 'w R k', what: 'w A t', was: 'w A z', of: 'A v', from: 'f r A m',
  been: 'b I n', said: 's e d', says: 's e z', does: 'd A z', put: 'p U t', could: 'k U d', would: 'w U d', should: 'sh U d',
  good: 'g U d', oh: 'oU', ooh: 'u', ah: 'a', yeah: 'y e @', hey: 'h eI', baby: "'b eI | b i", know: 'n oU', now: 'n aU',
  how: 'h aU', our: 'aU R', hour: 'aU R', people: "'p i | p @ l", beautiful: "'b y u | t @ | f U l", tonight: "t @ | 'n aI t",
  today: "t @ | 'd eI", tomorrow: "t @ | 'm a r | oU", together: "t @ | 'g e dh | R", because: "b i | 'k A z", 'cause': 'k A z',
  believe: "b @ | 'l i v", before: "b i | 'f o r", inside: "I n | 's aI d", outside: "aU t | 's aI d", nothing: "'n A th | I ng",
  something: "'s A m | th I ng", everything: "'e v | r i | th I ng", anything: "'e n | i | th I ng", body: "'b a | d i",
  little: "'l I | t @ l", life: 'l aI f', night: 'n aI t', light: 'l aI t', sky: 's k aI', time: 't aI m', mind: 'm aI n d',
  kind: 'k aI n d', find: 'f aI n d', behind: "b i | 'h aI n d", wild: 'w aI l d', child: 'ch aI l d', door: 'd o r',
  more: 'm o r', floor: 'f l o r', four: 'f o r', for: 'f o r', or: 'o r', sure: 'sh U r', soul: 's oU l', whole: 'h oU l',
  old: 'oU l d', cold: 'k oU l d', gold: 'g oU l d', hold: 'h oU l d', told: 't oU l d', go: 'g oU', so: 's oU', no: 'n oU',
  slow: 's l oU', show: 'sh oU', glow: 'g l oU', grow: 'g r oU', low: 'l oU', snow: 's n oU', flow: 'f l oU', below: "b i | 'l oU",
  shadow: "'sh ae | d oU", window: "'w I n | d oU", follow: "'f a | l oU", own: 'oU n', blown: 'b l oU n', known: 'n oU n',
  shown: 'sh oU n', home: 'h oU m', stone: 's t oU n', phone: 'f oU n', alive: "@ | 'l aI v", dance: 'd ae n s', move: 'm u v',
  lose: 'l u z', whose: 'h u z', through: 'th r u', true: 't r u', blue: 'b l u', new: 'n u', knew: 'n u', view: 'v y u',
  free: 'f r i', see: 's i', be: 'b i', we: 'w i', he: 'h i', she: 'sh i', sea: 's i', tree: 't r i', dream: 'd r i m',
  feel: 'f i l', real: 'r i l', here: 'h I R', near: 'n I R', clear: 'k l I R', fear: 'f I R', year: 'y I R', tear: 't I R',
  dear: 'd I R', hear: 'h I R', disappear: "d I s | @ | 'p I R", appear: "@ | 'p I R", air: 'e R', care: 'k e R', stare: 's t e R',
  higher: "'h aI | R", desire: "d @ | 'z aI R", wire: 'w aI R', water: "'w a | t R", "heart's": 'h a r t s', head: 'h e d',
  dead: 'd e d', bread: 'b r e d', ready: "'r e | d i", instead: "I n | 's t e d", ahead: "@ | 'h e d", breath: 'b r e th',
  breathe: 'b r i dh', touch: 't A ch', young: 'y A ng', enough: "i | 'n A f", rough: 'r A f', tough: 't A f', laugh: 'l ae f',
  thought: 'th o t', caught: 'k o t', brought: 'b r o t', fought: 'f o t', though: 'dh oU', all: 'o l', call: 'k o l',
  fall: 'f o l', wall: 'w o l', small: 's m o l', walk: 'w o k', talk: 't o k', want: 'w a n t', wanna: "'w a | n @",
  gonna: "'g A | n @", gotta: "'g a | t @", lady: "'l eI | d i", city: "'s I | t i", pretty: "'p r I | t i", money: "'m A | n i",
  honey: "'h A | n i", summer: "'s A | m R", river: "'r I | v R", ocean: "'oU | sh @ n", music: "'m y u | z I k",
  radio: "'r eI | d i | oU", memory: "'m e m | @ | r i", memories: "'m e m | @ | r i z", diamond: "'d aI | m @ n d",
  heartbeat: "'h a r t | b i t", sunshine: "'s A n | sh aI n", sunlight: "'s A n | l aI t", moonlight: "'m u n | l aI t",
  midnight: "'m I d | n aI t", highway: "'h aI | w eI", nobody: "'n oU | b a | d i", somebody: "'s A m | b a | d i",
  lover: "'l A | v R", other: "'A | dh R", mother: "'m A | dh R", brother: "'b r A | dh R", another: "@ | 'n A | dh R",
  wonder: "'w A n | d R", under: "'A n | d R", over: "'oU | v R", whatever: "w A t | 'e v | R", better: "'b e | t R",
  weather: "'w e | dh R", feeling: "'f i | l I ng", ceiling: "'s i | l I ng", tired: "'t aI | R d", hours: 'aU R z',
  power: "'p aU | R", flower: "'f l aU | R", tower: "'t aU | R", shower: "'sh aU | R", star: 's t a r', stars: 's t a r z',
war: 'w o r', warm: 'w o r m', earth: 'R th', learn: 'l R n', burn: 'b R n', turn: 't R n',
  her: 'h R', girl: 'g R l', first: 'f R s t', hurt: 'h R t', heard: 'h R d', search: 's R ch', sugar: "'sh U | g R",
  angel: "'eI n | j @ l", danger: "'d eI n | j R", stranger: "'s t r eI n | j R", change: 'ch eI n j', strange: 's t r eI n j',
  break: 'b r eI k', great: 'g r eI t', eight: 'eI t', weight: 'w eI t', wait: 'w eI t', rain: 'r eI n',   any: "'e n | i", many: "'m e n | i", friend: 'f r e n d', friends: 'f r e n d z', guess: 'g e s', blood: 'b l A d',
  flood: 'f l A d', cry: 'k r aI', why: 'w aI', fly: 'f l aI', die: 'd aI', lie: 'l aI', goodbye: "g U d | 'b aI", bye: 'b aI',
  hello: "h @ | 'l oU", okay: "oU | 'k eI", alright: "o l | 'r aI t", maybe: "'m eI | b i", lonely: "'l oU n | l i",
  open: "'oU | p @ n", broken: "'b r oU | k @ n", golden: "'g oU l | d @ n", even: "'i | v @ n",
  hand: 'h ae n d', hands: 'h ae n d z', stand: 's t ae n d', understand: "A n | d R | 's t ae n d", last: 'l ae s t',
  fast: 'f ae s t', past: 'p ae s t', can: 'k ae n', "can't": 'k ae n t', "don't": 'd oU n t', "won't": 'w oU n t',
  "it's": 'I t s', "that's": 'dh ae t s', "what's": 'w A t s', "let's": 'l e t s', "we're": 'w I R', "we'll": 'w i l',
  "she's": 'sh i z', "he's": 'h i z', "there's": 'dh e r z', "i'ma": "'aI | m @", "ain't": 'eI n t', 'tryna': "'t r aI | n @",
}

const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'is', 'are', 'was',
  'were', 'be', 'it', 'its', "it's", 'my', 'your', 'our', 'their', 'his', 'her', 'i', 'you', 'we', 'they', 'he', 'she', 'me',
  'us', 'them', 'that', 'this', 'so', 'if', 'than', 'then', 'can', 'will', 'just', 'do', 'does', 'did', 'am', "i'm", "you're",
  'up', 'like', 'all', 'oh', 'when', 'what', 'some', 'no', 'not', 'yeah',
])

const ONSET_BLENDS = new Set([
  'bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'tr', 'sc', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw',
  'tw', 'qu', 'wr', 'kn', 'thr', 'shr', 'str', 'spr', 'scr', 'spl', 'squ', 'chr', 'sch', 'ph', 'wh', 'th', 'sh', 'ch',
])
const DIGRAPHS = ['tch', 'ch', 'sh', 'th', 'ph', 'wh', 'ck', 'ng', 'gh', 'qu']

function isV(ch: string, i: number, w: string): boolean {
  if ('aeiou'.includes(ch)) return true
  if (ch === 'y') {
    const n = w[i + 1]
    return i > 0 && (n === undefined || !'aeiou'.includes(n))
  }
  return false
}

/** Orthographic syllables of a word (letters only, lowercase). */
export function syllabify(raw: string): string[] {
  const w = raw.toLowerCase().replace(/[^a-z']/g, '').replace(/'/g, '')
  if (!w) return [raw || '-']
  const dict = DICT[w] ?? DICT[raw.toLowerCase().replace(/[^a-z']/g, '')]
  if (dict) {
    const n = dict.split('|').length
    if (n === 1) return [w]
    return splitEven(w, n)
  }
  // vowel groups
  const groups: Array<[number, number]> = []
  let i = 0
  while (i < w.length) {
    if (isV(w[i], i, w)) {
      let j = i + 1
      while (j < w.length && isV(w[j], j, w)) {
        // hiatus: split "ia", "io", "eo", "ua", "uo", "iu" except after t/s/c/x/g (tion, cious, gion)
        const pair = w[j - 1] + w[j]
        if (['ia', 'io', 'iu', 'eo', 'ua', 'uo', 'ea'].includes(pair)) {
          const before = w[j - 2] ?? ''
          if (pair === 'ea') {
            if (/^(cre|ide|the|are|oce)/.test(w.slice(Math.max(0, j - 3), j + 1)) && /(ate|al|tion|as)/.test(w.slice(j + 1))) break
            j++
            continue
          }
          if (!'tscxg'.includes(before) && !(pair === 'ua' && before === 'q') && !(pair === 'uo' && before === 'q')) break
        }
        j++
      }
      groups.push([i, j])
      i = j
    } else i++
  }
  if (groups.length === 0) return [w]
  // silent final e / es / ed
  const last = groups[groups.length - 1]
  if (groups.length > 1) {
    const end = w.slice(last[0])
    const prev = w[last[0] - 1] ?? ''
    const prev2 = w[last[0] - 2] ?? ''
    let silent = false
    if (end === 'e') silent = !(prev === 'l' && !isV(prev2, last[0] - 2, w)) // keep "-ble", "-tle"
    else if (end === 'es') silent = !/[sxz]|ch|sh|ce|ge/.test(prev2 + prev) && !(prev === 'l' && !isV(prev2, 0, w))
    else if (end === 'ed') silent = !'td'.includes(prev)
    if (silent) groups.pop()
  }
  if (groups.length === 1) return [w]
  // split consonant clusters between groups
  const cuts: number[] = []
  for (let g = 0; g < groups.length - 1; g++) {
    const cs = groups[g][1]
    const ce = groups[g + 1][0]
    const cl = w.slice(cs, ce)
    let cut: number
    if (cl.length === 0) cut = cs
    else if (cl.length === 1) cut = cl === 'x' ? ce : cs
    else {
      const digraph = DIGRAPHS.find((d) => cl === d)
      if (digraph) cut = digraph === 'ck' || digraph === 'ng' || digraph === 'gh' ? ce : cs
      else {
        // longest valid onset at the end of the cluster (max 3), but leave at least one consonant behind for clusters >= 2
        let best = 1
        for (let k = Math.min(3, cl.length - 1); k >= 2; k--) {
          if (ONSET_BLENDS.has(cl.slice(cl.length - k))) {
            best = k
            break
          }
        }
        if (cl.length === 2 && DIGRAPHS.includes(cl)) best = 2
        // "le" ending: keep consonant with "le" (ta-ble, lit-tle)
        cut = ce - best
        if (cl.length >= 2 && cl[cl.length - 1] === cl[cl.length - 2]) cut = ce - 1 // doubled consonant
      }
    }
    cuts.push(cut)
  }
  const out: string[] = []
  let p = 0
  for (const c of cuts) {
    out.push(w.slice(p, c))
    p = c
  }
  out.push(w.slice(p))
  return out.filter((s) => s.length > 0)
}

function splitEven(w: string, n: number): string[] {
  const out: string[] = []
  const step = w.length / n
  for (let i = 0; i < n; i++) out.push(w.slice(Math.round(i * step), Math.round((i + 1) * step)))
  return out.map((s) => s || w[0])
}

function parseDict(spec: string, word: string): SylPhones[] {
  const syls = spec.split('|').map((s) => s.trim())
  const multi = syls.length > 1
  const hasMark = syls.some((s) => s.startsWith("'"))
  const ortho = splitEven(word, syls.length)
  return syls.map((s, idx) => {
    const marked = s.startsWith("'")
    const toks = s.replace(/^'/, '').split(/\s+/).filter(Boolean)
    const onset: Cons[] = []
    const vowels: Vowel[] = []
    const coda: Cons[] = []
    for (const t of toks) {
      if (VOWEL_TOKENS[t]) {
        if (coda.length) {
          // vowel after coda (shouldn't happen) -> treat as more vowels
          vowels.push(...VOWEL_TOKENS[t])
        } else vowels.push(...VOWEL_TOKENS[t])
      } else if (CONS_SET.has(t)) {
        if (!vowels.length) onset.push(t as Cons)
        else if (t === 'r' && coda.length === 0) vowels.push('R')
        else coda.push(t as Cons)
      }
    }
    if (!vowels.length) vowels.push('@')
    let stress = 2
    if (multi) stress = hasMark ? (marked ? 2 : 0) : idx === 0 ? 2 : 0
    else stress = FUNCTION_WORDS.has(word) ? 1 : 2
    return { text: ortho[idx], onset, vowels, coda, stress }
  })
}

// ---------------------------------------------------------------- letter-to-sound
function consonants(letters: string, isOnset: boolean, nextVowel: string): Cons[] {
  const out: Cons[] = []
  let i = 0
  const s = letters
  while (i < s.length) {
    const rest = s.slice(i)
    const two = rest.slice(0, 2)
    const three = rest.slice(0, 3)
    if (three === 'tch') {
      out.push('ch')
      i += 3
      continue
    }
    if (three === 'dge') {
      out.push('j')
      i += 3
      continue
    }
    if (two === 'th') {
      out.push('th')
      i += 2
      continue
    }
    if (two === 'sh') {
      out.push('sh')
      i += 2
      continue
    }
    if (two === 'ch') {
      out.push('ch')
      i += 2
      continue
    }
    if (two === 'ph') {
      out.push('f')
      i += 2
      continue
    }
    if (two === 'wh') {
      out.push('w')
      i += 2
      continue
    }
    if (two === 'ck') {
      out.push('k')
      i += 2
      continue
    }
    if (two === 'ng') {
      out.push('ng')
      i += 2
      continue
    }
    if (two === 'nk') {
      out.push('ng', 'k')
      i += 2
      continue
    }
    if (two === 'gh') {
      if (!isOnset && i > 0) out.push('f')
      else if (isOnset) out.push('g')
      i += 2
      continue
    }
    if (two === 'qu') {
      out.push('k', 'w')
      i += 2
      continue
    }
    if (two === 'kn' && isOnset && i === 0) {
      out.push('n')
      i += 2
      continue
    }
    if (two === 'wr' && isOnset && i === 0) {
      out.push('r')
      i += 2
      continue
    }
    if (two === 'mb' && !isOnset && i + 2 === s.length) {
      out.push('m')
      i += 2
      continue
    }
    const c = s[i]
    const nxt = s[i + 1] ?? nextVowel
    if (c === s[i - 1]) {
      i++
      continue
    }
    switch (c) {
      case 'c':
        out.push(nxt && 'eiy'.includes(nxt) ? 's' : 'k')
        break
      case 'g':
        out.push(nxt && 'eiy'.includes(nxt) && isOnset ? 'j' : 'g')
        break
      case 'x':
        out.push('k', 's')
        break
      case 'q':
        out.push('k')
        break
      case 'j':
        out.push('j')
        break
      case 'y':
        out.push('y')
        break
      case 's':
        out.push(!isOnset && i === s.length - 1 && i > 0 && 'bdglmnrvw'.includes(s[i - 1]) ? 'z' : 's')
        break
      case 'b': case 'd': case 'f': case 'h': case 'k': case 'l': case 'm': case 'n': case 'p': case 'r': case 't': case 'v': case 'w': case 'z':
        if (!(c === 'h' && !isOnset)) out.push(c as Cons)
        break
      default:
        break
    }
    i++
  }
  return out
}

function nucleus(v: string, coda: string, ctx: { open: boolean; magicE: boolean; last: boolean; single: boolean; word: string }): Vowel[] {
  const { open, magicE, last, single } = ctx
  const r = coda.startsWith('r')
  const V = (x: string) => VOWEL_TOKENS[x]
  // r-coloured
  if (r) {
    if (v === 'a' || v === 'ea' && coda === 'rt') return ['a', 'R']
    if (v === 'o' || v === 'oo' || v === 'ou' || v === 'oa') return ['o', 'R']
    if (v === 'e' || v === 'i' || v === 'u' || v === 'ea' || v === 'ou' || v === 'y') {
      if (magicE && (v === 'e' || v === 'i')) return v === 'i' ? ['a', 'i', 'R'] : ['I', 'R']
      return ['R']
    }
    if (v === 'ee' || v === 'ea' || v === 'ie') return ['I', 'R']
    if (v === 'ai' || v === 'ei') return ['e', 'R']
  }
  switch (v) {
    case 'a':
      if (coda.startsWith('ll') || coda.startsWith('lk') || coda === 'w' || coda.startsWith('lt')) return ['o']
      if (magicE || (open && !last)) return V('eI')
      if (open && last && !single) return ['@']
      if (open && last && single) return ['a']
      return ['ae']
    case 'e':
      if (magicE || (open && (single || !last))) return ['i']
      if (open && last) return ['i']
      return ['e']
    case 'i':
      if (magicE || coda.startsWith('gh') || coda === 'nd' || coda === 'ld' || (open && single)) return V('aI')
      return ['I']
    case 'o':
      if (magicE || (open && (single || last)) || coda === 'ld' || coda === 'lt' || coda === 'st' && single) return V('oU')
      if (coda === 'n' && ctx.word.endsWith('on') && !single) return ['@']
      return ['a']
    case 'u':
      if (magicE || (open && single)) return ['u']
      if (coda === 'll' || coda === 'sh' || coda === 't' && ctx.word.startsWith('p')) return ['U']
      return ['A']
    case 'y':
      if (single || (open && !last)) return V('aI')
      return ['i']
    case 'ee': case 'ie': case 'ei': case 'ey':
      if (v === 'ie' && last && open) return V('aI')
      if (v === 'ey' && last) return single ? V('eI') : ['i']
      return ['i']
    case 'ea':
      if (coda === 'd' || coda === 'th' || coda === 'lth' || coda === 'vy') return ['e']
      return ['i']
    case 'oo':
      if (coda === 'k' || coda === 'd' && !ctx.word.includes('food') || coda === 't' && ctx.word.includes('foot')) return ['U']
      return ['u']
    case 'ou':
      if (coda === 'ld') return ['U']
      if (coda === 'gh' || coda === 'ght') return ['o']
      return V('aU')
    case 'ow':
      return V('aU')
    case 'oa': case 'oe':
      return V('oU')
    case 'ai': case 'ay':
      return V('eI')
    case 'oi': case 'oy':
      return V('oI')
    case 'au': case 'aw':
      return ['o']
    case 'ue': case 'ui': case 'ew': case 'eu':
      return ['u']
    case 'eye': case 'aye':
      return V('aI')
    case 'io': case 'ia':
      return ['@']
    default:
      if (v.length > 1) return nucleus(v[0], coda, ctx)
      return ['@']
  }
}

/** Phones for each syllable of a word. */
export function wordPhones(raw: string): SylPhones[] {
  const lw = raw.toLowerCase().replace(/[^a-z']/g, '')
  const w = lw.replace(/'/g, '')
  if (!w) return [{ text: raw || '-', onset: [], vowels: ['@'], coda: [], stress: 1 }]
  const d = DICT[lw] ?? DICT[w]
  if (d) return parseDict(d, w)
  const syls = syllabify(w)
  const single = syls.length === 1
  const magicEWord = /[aeiouy][^aeiouy]e$/.test(w) && !/[^aeiou]le$/.test(w) || /[aeiouy][^aeiouy]es$/.test(w)
  const out: SylPhones[] = []
  const prefixStress = /^(a|be|de|re|to|for|in|un|ex|con|com|dis|pre|pro)[^aeiou]/.test(w) && syls.length >= 2 && !/^(an|en|in)[aeiou]/.test(w)
  for (let si = 0; si < syls.length; si++) {
    let s = syls[si]
    const last = si === syls.length - 1
    let magicE = false
    if (last && magicEWord && s.length > 2 && s.endsWith('e')) {
      s = s.slice(0, -1)
      magicE = true
    } else if (last && magicEWord && s.endsWith('es') && s.length > 3) {
      s = s.slice(0, -2) + 's'
      magicE = true
    }
    if (last && s.endsWith('ed') && s.length > 2 && !'td'.includes(s[s.length - 3])) s = s.slice(0, -2) + 'd'
    // split letters
    let a = 0
    while (a < s.length && !isV(s[a], a + (si === 0 ? 0 : 1), s)) a++
    let b = a
    while (b < s.length && isV(s[b], b + 1, s)) b++
    // 'y' at start of syllable before vowel is consonant
    let onsetL = s.slice(0, a)
    let vow = s.slice(a, b)
    let codaL = s.slice(b)
    if (!vow) {
      // syllabic consonant (e.g. "le" handled below) or no vowel
      vow = ''
    }
    if (vow === 'e' && codaL === '' && onsetL.endsWith('l') && !single && last) {
      // "-le" (ta-ble): syllabic l
      onsetL = onsetL.slice(0, -1)
      out.push({ text: syls[si], onset: consonants(onsetL, true, ''), vowels: ['@'], coda: ['l'], stress: 0 })
      continue
    }
    if (vow.endsWith('w') && vow.length > 1 && codaL === '') {
      // ow / aw / ew handled by nucleus
    }
    const nextSyl = syls[si + 1] ?? ''
    const open = codaL === ''
    let vowels: Vowel[]
    if (!vow) vowels = ['@']
    else if (vow === 'ow' || (vow === 'o' && codaL.startsWith('w'))) {
      const finalOw = last && (codaL === '' || codaL === 'w' || codaL === 's' || codaL === 'n')
      const prev = onsetL[onsetL.length - 1] ?? ''
      vowels = finalOw && 'lnrdw'.includes(prev) && !/^(now|how|wow|cow|vow|brown|down|town|crown|clown|gown|frown)$/.test(w) ? VOWEL_TOKENS.oU : VOWEL_TOKENS.aU
      if (codaL.startsWith('w')) codaL = codaL.slice(1)
    } else vowels = nucleus(vow, codaL, { open, magicE, last, single, word: w })
    if (codaL === 'gh' || codaL === 'ght') codaL = codaL === 'ght' ? 't' : ''
    if (codaL.startsWith('gh')) codaL = codaL.slice(2)
    const onset = consonants(onsetL, true, vow[0] ?? '')
    let coda = consonants(codaL, false, nextSyl[0] ?? '')
    // coda r -> r-colouring vowel
    if (coda[0] === 'r') {
      if (vowels[vowels.length - 1] !== 'R') vowels = [...vowels, 'R']
      coda = coda.slice(1)
    }
    let stress = 0
    if (single) stress = FUNCTION_WORDS.has(w) ? 1 : 2
    else if (prefixStress) stress = si === 1 ? 2 : 0
    else if (/(tion|sion|cian)$/.test(w)) stress = si === syls.length - 2 ? 2 : 0
    else stress = si === 0 ? 2 : 0
    out.push({ text: syls[si], onset, vowels, coda, stress })
  }
  return out
}

/** Approximate number of sung syllables in a line of text. */
export function countSyllables(text: string): number {
  let n = 0
  for (const w of text.split(/\s+/)) if (w.replace(/[^a-z0-9]/gi, '')) n += syllabify(w).length
  return n
}
