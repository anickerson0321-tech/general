// Template/grammar based lyric writer producing Suno meta-tag formatted lyrics.
import { Rng, mixSeed } from './rng'
import { countSyllables } from './syllables'

type Pos = 'n' | 'a' | 'v' | 'x' | 'o'

// rhyme families: word -> part of speech (n noun, a adjective, v verb (base), x adverb/other)
const RHYMES: Array<Array<[string, Pos]>> = [
  [['night', 'n'], ['light', 'n'], ['fight', 'v'], ['bright', 'a'], ['tight', 'a'], ['right', 'a'], ['tonight', 'x'], ['sight', 'n'], ['flight', 'n'], ['alright', 'x'], ['white', 'a'], ['ignite', 'v'], ['shine bright', 'v'], ['satellite', 'n']],
  [['day', 'n'], ['way', 'n'], ['stay', 'v'], ['away', 'x'], ['play', 'v'], ['gray', 'a'], ['okay', 'x'], ['today', 'x'], ['say', 'v'], ['fade away', 'v'], ['sway', 'v'], ['escape', 'v'], ['yesterday', 'x'], ['highway', 'n']],
  [['fire', 'n'], ['higher', 'x'], ['desire', 'n'], ['wire', 'n'], ['inspire', 'v'], ['choir', 'n'], ['retire', 'v'], ['entire', 'a'], ['liar', 'n']],
  [['go', 'v'], ['know', 'v'], ['glow', 'n'], ['slow', 'a'], ['show', 'v'], ['below', 'x'], ['let go', 'v'], ['grow', 'v'], ['snow', 'n'], ['radio', 'n'], ['shadow', 'n'], ['window', 'n'], ['long ago', 'x'], ['overflow', 'v']],
  [['alone', 'x'], ['home', 'n'], ['own', 'a'], ['stone', 'n'], ['phone', 'n'], ['bone', 'n'], ['known', 'a'], ['unknown', 'a'], ['zone', 'n'], ['throne', 'n'], ['grown', 'a']],
  [['you', 'o'], ['true', 'a'], ['blue', 'a'], ['through', 'x'], ['new', 'a'], ['do', 'v'], ['view', 'n'], ['breakthrough', 'n'], ['come true', 'v'], ['shoes', 'n'], ['avenue', 'n'], ['brand new', 'a']],
  [['rain', 'n'], ['pain', 'n'], ['again', 'x'], ['chain', 'n'], ['train', 'n'], ['lane', 'n'], ['remain', 'v'], ['explain', 'v'], ['insane', 'a'], ['flame', 'n'], ['name', 'n'], ['window pane', 'n'], ['hurricane', 'n']],
  [['heart', 'n'], ['apart', 'x'], ['start', 'v'], ['art', 'n'], ['dark', 'n'], ['spark', 'n'], ['mark', 'n'], ['restart', 'v'], ['falling apart', 'a'], ['work of art', 'n']],
  [['song', 'n'], ['along', 'x'], ['strong', 'a'], ['long', 'a'], ['belong', 'v'], ['wrong', 'a'], ['on and on', 'x'], ['all night long', 'x'], ['gone', 'a']],
  [['free', 'a'], ['me', 'o'], ['see', 'v'], ['be', 'v'], ['sea', 'n'], ['believe', 'v'], ['dream', 'n'], ['breathe', 'v'], ['leave', 'v'], ['eternity', 'n'], ['melody', 'n'], ['memory', 'n'], ['symphony', 'n'], ['gravity', 'n']],
  [['alive', 'a'], ['drive', 'v'], ['survive', 'v'], ['arrive', 'v'], ['dive', 'v'], ['thrive', 'v'], ['skyline', 'n'], ['high', 'a'], ['sky', 'n'], ['fly', 'v'], ['try', 'v'], ['cry', 'v'], ['goodbye', 'n'], ['tonight', 'x'], ['lullaby', 'n']],
  [['mind', 'n'], ['find', 'v'], ['behind', 'x'], ['kind', 'a'], ['blind', 'a'], ['time', 'n'], ['shine', 'v'], ['line', 'n'], ['sign', 'n'], ['fine', 'a'], ['divine', 'a'], ['design', 'n'], ['rewind', 'v']],
  [['fall', 'v'], ['call', 'v'], ['after all', 'x'], ['wall', 'n'], ['small', 'a'], ['tall', 'a'], ['ball', 'n'], ['crawl', 'v'], ['hall', 'n'], ['waterfall', 'n']],
  [['here', 'x'], ['near', 'x'], ['clear', 'a'], ['fear', 'n'], ['year', 'n'], ['tear', 'n'], ['disappear', 'v'], ['appear', 'v'], ['atmosphere', 'n'], ['frontier', 'n'], ['sincere', 'a']],
  [['sound', 'n'], ['ground', 'n'], ['around', 'x'], ['found', 'a'], ['down', 'x'], ['around', 'x'], ['town', 'n'], ['crown', 'n'], ['drown', 'v'], ['underground', 'x'], ['profound', 'a']],
  [['place', 'n'], ['face', 'n'], ['space', 'n'], ['chase', 'v'], ['race', 'n'], ['grace', 'n'], ['embrace', 'v'], ['trace', 'n'], ['erase', 'v']],
  [['forever', 'x'], ['never', 'x'], ['together', 'x'], ['whatever', 'x'], ['ever', 'x'], ['better', 'a'], ['weather', 'n'], ['feather', 'n']],
  [['moon', 'n'], ['soon', 'x'], ['tune', 'n'], ['june', 'n'], ['balloon', 'n'], ['room', 'n'], ['bloom', 'v'], ['afternoon', 'n'], ['cocoon', 'n']],
  [['gold', 'n'], ['cold', 'a'], ['hold', 'v'], ['old', 'a'], ['told', 'v'], ['bold', 'a'], ['soul', 'n'], ['control', 'n'], ['whole', 'a'], ['unfold', 'v'], ['roll', 'v']],
  [['sun', 'n'], ['run', 'v'], ['the one', 'n'], ['done', 'a'], ['fun', 'n'], ['young', 'a'], ['begun', 'a'], ['someone', 'n'], ['undone', 'a'], ['everyone', 'n']],
  [['ocean', 'n'], ['motion', 'n'], ['emotion', 'n'], ['devotion', 'n'], ['potion', 'n'], ['slow motion', 'n']],
]

interface Theme {
  n: string[] // nouns (singular)
  a: string[] // adjectives
  v: string[] // verbs base
  g: string[] // verbs -ing
  p: string[] // place phrases ("the city")
  words: string[] // trigger words
}

const THEMES: Record<string, Theme> = {
  love: {
    words: ['love', 'heart', 'kiss', 'romance', 'darling', 'baby', 'crush', 'valentine', 'wedding', 'romantic', 'girlfriend', 'boyfriend'],
    n: ['heartbeat', 'kiss', 'promise', 'touch', 'smile', 'whisper', 'secret', 'rose', 'letter', 'moment'],
    a: ['golden', 'tender', 'endless', 'sweet', 'gentle', 'crazy', 'beautiful', 'warm'],
    v: ['hold', 'love', 'stay', 'dance', 'fall', 'stay close', 'feel'],
    g: ['falling', 'holding', 'dancing', 'dreaming', 'waiting', 'burning', 'shining'],
    p: ['the kitchen light', 'your arms', 'the summer rain', 'the city', 'the back seat', 'the crowded room'],
  },
  heartbreak: {
    words: ['sad', 'breakup', 'break up', 'goodbye', 'miss', 'lost', 'lonely', 'tears', 'cry', 'ex', 'leaving', 'gone', 'heartbreak', 'regret'],
    n: ['photograph', 'echo', 'shadow', 'letter', 'silence', 'ghost', 'memory', 'promise', 'empty chair', 'storm'],
    a: ['broken', 'empty', 'quiet', 'faded', 'hollow', 'lonely', 'heavy', 'cold'],
    v: ['forget', 'let go', 'move on', 'hold on', 'fall', 'pretend', 'wait'],
    g: ['fading', 'falling', 'waiting', 'breaking', 'drifting', 'crying', 'running'],
    p: ['the empty hall', 'the rain', 'the dark', 'the old café', 'the station', 'the back road'],
  },
  party: {
    words: ['party', 'dance', 'club', 'weekend', 'friday', 'saturday', 'celebrate', 'drinks', 'dj', 'groove', 'fun'],
    n: ['bassline', 'spotlight', 'rhythm', 'disco ball', 'crowd', 'heartbeat', 'speaker', 'champagne', 'party'],
    a: ['electric', 'wild', 'loud', 'golden', 'crazy', 'neon', 'shiny', 'restless'],
    v: ['dance', 'move', 'jump', 'shine', 'party', 'let go', 'turn it up'],
    g: ['dancing', 'moving', 'jumping', 'shining', 'spinning', 'glowing', 'burning'],
    p: ['the dance floor', 'the city', 'the club', 'the rooftop', 'the crowd', 'the speakers'],
  },
  night: {
    words: ['night', 'city', 'neon', 'midnight', 'lights', 'street', 'downtown', 'stars', 'moon', 'late'],
    n: ['streetlight', 'skyline', 'neon sign', 'taxi', 'rooftop', 'starlight', 'midnight', 'radio', 'satellite'],
    a: ['neon', 'electric', 'silver', 'endless', 'restless', 'midnight', 'violet', 'shimmering'],
    v: ['drive', 'run', 'chase', 'glow', 'shine', 'fly', 'escape'],
    g: ['driving', 'running', 'chasing', 'glowing', 'flying', 'drifting', 'racing'],
    p: ['the boulevard', 'the city', 'the highway', 'the neon rain', 'the rooftop', 'the avenue'],
  },
  freedom: {
    words: ['road', 'trip', 'drive', 'summer', 'free', 'freedom', 'escape', 'run', 'wild', 'highway', 'travel', 'adventure', 'journey'],
    n: ['highway', 'horizon', 'open road', 'sunset', 'engine', 'map', 'wind', 'canyon', 'radio'],
    a: ['wild', 'open', 'endless', 'golden', 'free', 'restless', 'dusty', 'sunburned'],
    v: ['drive', 'run', 'ride', 'roam', 'fly', 'chase', 'break free'],
    g: ['driving', 'running', 'riding', 'flying', 'chasing', 'rolling', 'wandering'],
    p: ['the open road', 'the coast', 'the desert', 'the mountains', 'the county line', 'the sunset'],
  },
  nostalgia: {
    words: ['home', 'childhood', 'memories', 'remember', 'old', 'young', 'yesterday', 'school', 'hometown', 'nostalgia', 'growing up'],
    n: ['polaroid', 'backyard', 'porch light', 'old guitar', 'summer', 'bicycle', 'mixtape', 'treehouse', 'photograph'],
    a: ['younger', 'golden', 'faded', 'simple', 'innocent', 'dusty', 'sunlit', 'old'],
    v: ['remember', 'go back', 'hold on', 'return', 'smile', 'stay young'],
    g: ['remembering', 'growing', 'running', 'laughing', 'dreaming', 'drifting', 'rolling'],
    p: ['the old town', 'the backyard', 'the school yard', 'the river', 'the porch', 'the hometown streets'],
  },
  faith: {
    words: ['god', 'faith', 'pray', 'prayer', 'church', 'heaven', 'grace', 'praise', 'lord', 'hope', 'spirit', 'soul', 'angel'],
    n: ['prayer', 'mercy', 'river', 'mountain', 'morning', 'glory', 'promise', 'light', 'shelter'],
    a: ['holy', 'faithful', 'gracious', 'mighty', 'humble', 'golden', 'peaceful', 'shining'],
    v: ['pray', 'rise', 'sing', 'believe', 'praise', 'lift', 'stand'],
    g: ['rising', 'singing', 'praying', 'shining', 'lifting', 'standing', 'calling'],
    p: ['the valley', 'the mountain', 'the river', 'the morning light', 'the storm', 'the open sky'],
  },
  nature: {
    words: ['ocean', 'sea', 'beach', 'mountain', 'forest', 'river', 'rain', 'sun', 'sky', 'flower', 'garden', 'snow', 'winter', 'spring', 'autumn', 'storm', 'wave', 'tree'],
    n: ['ocean', 'river', 'mountain', 'meadow', 'thunder', 'wildflower', 'tide', 'willow', 'sunrise'],
    a: ['gentle', 'endless', 'silver', 'golden', 'wild', 'quiet', 'evergreen', 'misty'],
    v: ['grow', 'flow', 'rise', 'bloom', 'wander', 'breathe', 'shine'],
    g: ['growing', 'flowing', 'rising', 'blooming', 'wandering', 'falling', 'shining'],
    p: ['the valley', 'the shoreline', 'the forest', 'the hills', 'the river', 'the open field'],
  },
  ambition: {
    words: ['money', 'hustle', 'grind', 'success', 'win', 'dream', 'boss', 'rich', 'fame', 'goal', 'champion', 'fight', 'rise', 'struggle', 'street'],
    n: ['hustle', 'crown', 'skyline', 'paper', 'vision', 'struggle', 'engine', 'mountain', 'empire'],
    a: ['hungry', 'fearless', 'focused', 'golden', 'restless', 'unstoppable', 'heavy', 'real'],
    v: ['rise', 'grind', 'win', 'climb', 'run', 'build', 'take it'],
    g: ['rising', 'grinding', 'climbing', 'running', 'building', 'chasing', 'working'],
    p: ['the block', 'the city', 'the top', 'the bottom', 'the streets', 'the corner'],
  },
}

const STOP = new Set(
  ('a an the and or but of to in on at for with by from as is are was were be it its this that these those my your our their his her ' +
    'i you we they he she me us them song songs about lyrics lyric write make create track tune music sing singing sung ' +
    'some something someone very really just like want need please feel feeling style vibe vibes type kind sort ' +
    'pop rock trap rap hip hop edm house jazz country folk ballad metal punk reggae gospel kpop k-pop lofi lo-fi soul rnb r&b ' +
    'synthwave cinematic orchestral acoustic electronic upbeat sad happy dark dreamy chill epic slow fast female male vocals voice ' +
    'bpm beat beats instrumental verse chorus bridge who what when where how why which into over under through ' +
    'after before during until while since without within around across along behind beyond near far much many more most other another every each long').split(/\s+/),
)

function title(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function plural(n: string): string {
  if (/(s|sh|ch|x)$/.test(n)) return n + 'es'
  if (/[^aeiou]y$/.test(n)) return n.slice(0, -1) + 'ies'
  return n + 's'
}

interface Ctx {
  r: Rng
  th: Theme
  topic: string
  topics: string[]
}

function fill(tpl: string, c: Ctx, rhyme: string): string {
  const r = c.r
  return tpl
    .replace(/\{T\}/g, () => c.topic)
    .replace(/\{T2\}/g, () => r.pick(c.topics))
    .replace(/\{N\}/g, () => r.pick(c.th.n))
    .replace(/\{Ns\}/g, () => plural(r.pick(c.th.n)))
    .replace(/\{A\}/g, () => r.pick(c.th.a))
    .replace(/\{V\}/g, () => r.pick(c.th.v))
    .replace(/\{G\}/g, () => r.pick(c.th.g))
    .replace(/\{P\}/g, () => r.pick(c.th.p))
    .replace(/\{R\}/g, rhyme)
}

// templates ending in a rhyme slot of the given part of speech
const VERSE: Array<[string, Pos]> = [
  ['Every {N} reminds me of the {R}', 'n'],
  ['I can hear the {N} calling through the {R}', 'n'],
  ['Walking down {P} like a {A} {R}', 'n'],
  ['Underneath the {N}, we were chasing the {R}', 'n'],
  ['Counting all the {Ns} in the {R}', 'n'],
  ['{T} in the morning and a {A} {R}', 'n'],
  ['Holding on to {T} like a {R}', 'n'],
  ['We were young and {A} in the {R}', 'n'],
  ['Windows down and we keep {G} {R}', 'x'],
  ["I don't want to {V} {R}", 'x'],
  ['Maybe we could {V} {R}', 'x'],
  ['Tell me how to {R}', 'v'],
  ['Lost inside {P}, I just want to {R}', 'v'],
  ['Every little thing about the {T} feels {R}', 'a'],
  ['When the {N} is {A} and the night feels {R}', 'a'],
  ['Paint the {N} in colors, make it {R}', 'a'],
  ['Got a {A} {N} and a heart so {R}', 'a'],
  ['Talking about {T} till the {R}', 'n'],
  ["There's a {N} in {P} that I can't {R}", 'v'],
  ['You and me and the {T}, {G} {R}', 'x'],
  ['I keep {G} back to the {R}', 'n'],
  ['All the {Ns} are {G} {R}', 'x'],
  ['Thinking of the {T} and the {R}', 'n'],
  ['Caught up in the {N}, I could never {R}', 'v'],
]

const PRE: Array<[string, Pos]> = [
  ['And I can feel it {G} {R}', 'x'],
  ["Something's in the {R}", 'n'],
  ['Here it comes, here it comes, {R}', 'x'],
  ['Can you feel the {N} {R}', 'x'],
  ["So don't let it {R}", 'v'],
  ['Hold your breath and {R}', 'v'],
  ['We were born to {R}', 'v'],
  ['Every {N} is {R}', 'a'],
]

const CHORUS_HOOK: Array<[string, Pos]> = [
  ['Oh, {T}, take me {R}', 'x'],
  ['{T}, you are my {R}', 'n'],
  ['{T}, {T}, never let me {R}', 'v'],
  ["We're {G} in the {T} {R}", 'x'],
  ['Take me to the {T}, take me {R}', 'x'],
  ['Oh, {T}, I feel {R}', 'a'],
  ["{T}, I'm coming back to {R}", 'o'],
  ['Hold on, {T}, hold on to {R}', 'o'],
]
const CHORUS: Array<[string, Pos]> = [
  ['So come on, {V} with me {R}', 'x'],
  ["I'll be right here waiting for {R}", 'o'],
  ['Nothing in the world compares to {R}', 'o'],
  ['Turn it up and let the {N} {R}', 'v'],
  ['And I feel {A}, I feel {R}', 'a'],
  ['Hold me like the {R}', 'n'],
  ['Never gonna let it {R}', 'v'],
  ['Light it up like a {R}', 'n'],
  ["We'll be {G} {R}", 'x'],
  ['We are the {Ns} of the {R}', 'n'],
  ['Sing it loud, we are {R}', 'a'],
  ['Hands up, hearts {R}', 'x'],
  ['Like a {A} {R}', 'n'],
  ['All we need is the {R}', 'n'],
  ["Don't you ever let it {R}", 'v'],
]

const BRIDGE: Array<[string, Pos]> = [
  ['If the {N} falls and the world goes {R}', 'a'],
  ["I'll be {G} for the {R}", 'n'],
  ['All the {Ns} we left {R}', 'x'],
  ['Close your eyes and {R}', 'v'],
  ['When the {N} is gone, will you {R}', 'v'],
  ['Even when the {N} turns {R}', 'a'],
  ['Maybe {T} is all we {R}', 'v'],
  ['Slowly, slowly, {R}', 'x'],
]

const OUTRO: string[] = ['Oh, {T}', '{T}, {T}', 'Just you and me and the {T}', 'Oh-oh, oh-oh']

function pickTheme(text: string, r: Rng): string {
  const t = ` ${text.toLowerCase()} `
  let best = ''
  let bestScore = 0
  for (const [name, th] of Object.entries(THEMES)) {
    let s = 0
    for (const w of th.words) if (t.includes(` ${w}`) || t.includes(`${w} `)) s += 1
    if (s > bestScore) {
      bestScore = s
      best = name
    }
  }
  return best || r.pick(['love', 'night', 'freedom', 'nostalgia', 'party'])
}

function extractTopics(prompt: string): string[] {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z' -]/g, ' ')
    .split(/[\s-]+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
  const ok = (w: string) => w.length >= 3 && !STOP.has(w)
  const out: string[] = []
  // a compound of two adjacent content words ("road trip", "neon city") makes the best hook topic
  for (let i = 0; i + 1 < words.length; i++) {
    if (ok(words[i]) && ok(words[i + 1]) && !/(ing|ly)$/.test(words[i + 1])) {
      out.push(`${words[i]} ${words[i + 1]}`)
      break
    }
  }
  for (const w of words) if (ok(w) && !out.includes(w)) out.push(w)
  return out.slice(0, 4)
}

interface Family {
  words: Array<[string, Pos]>
  used: Set<string>
}

function pickFamily(r: Rng, avoid: Family[]): Family {
  for (let k = 0; k < 20; k++) {
    const f = r.pick(RHYMES)
    if (!avoid.some((a) => a.words === f)) return { words: f, used: new Set() }
  }
  return { words: r.pick(RHYMES), used: new Set() }
}

function rhymeWord(f: Family, pos: Pos, r: Rng): string | null {
  const cands = f.words.filter(([w, p]) => p === pos && !f.used.has(w))
  if (!cands.length) return null
  const w = r.pick(cands)[0]
  f.used.add(w)
  return w
}

function makeLine(c: Ctx, tpls: Array<[string, Pos]>, f: Family, minS = 5, maxS = 11): string {
  let fallback = ''
  for (let tries = 0; tries < 24; tries++) {
    const [tpl, pos] = c.r.pick(tpls)
    const cands = f.words.filter(([w, p]) => p === pos && !f.used.has(w))
    if (!cands.length) continue
    const w = c.r.pick(cands)[0]
    const line = tidy(fill(tpl, c, w))
    const n = countSyllables(line)
    if (n >= minS && n <= maxS) {
      f.used.add(w)
      return line
    }
    if (!fallback) fallback = line
  }
  if (fallback) return fallback
  const w = rhymeWord(f, 'n', c.r) ?? f.words[0][0]
  return cap(`Oh, the ${w}`)
}

function makeHook(c: Ctx, f: Family): string {
  for (let tries = 0; tries < 40; tries++) {
    const [tpl, pos] = c.r.pick(CHORUS_HOOK)
    const w = rhymeWord(f, pos, c.r)
    if (!w) continue
    const line = tidy(fill(tpl, c, w))
    const n = countSyllables(line)
    if (n >= 4 && n <= 11) return line
    f.used.delete(w)
  }
  return tidy(`Oh, ${c.topic}, take me tonight`)
}

/** articles, duplicate words, capitalisation */
function tidy(line: string): string {
  let l = line.replace(/\b([Aa]) ([aeiou])/g, '$1n $2').replace(/\b(\w+) \1\b/gi, (m, w) => (/^(oh|summer|night|love|\w+)$/i.test(w) && /,/.test(m) ? m : w))
  l = l.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim()
  return cap(l)
}

/**
 * Write lyrics about the prompt's topic. Returns Suno meta-tag formatted text:
 * [Verse 1] [Pre-Chorus] [Chorus] [Verse 2] [Pre-Chorus] [Chorus] [Bridge] [Chorus] [Outro]
 */
export function generateLocalLyrics(prompt: string, seed: number, opts?: { genre?: string; mood?: string }): { title: string; lyrics: string } {
  const r = new Rng(mixSeed(seed, 'lyrics', prompt))
  const themeName = pickTheme(`${prompt} ${opts?.mood ?? ''} ${opts?.genre ?? ''}`, r)
  const th = THEMES[themeName]
  const topics = extractTopics(prompt)
  if (!topics.length) topics.push(r.pick(th.n))
  // prefer a noun-ish topic: the last of the first two content words reads more naturally
  const topic = topics.length >= 2 && /(ing|ly|ful|ous|ive)$/.test(topics[0]) ? topics[1] : topics[0]
  const c: Ctx = { r, th, topic, topics }
  const fams: Family[] = []
  const fam = () => {
    const f = pickFamily(r, fams)
    fams.push(f)
    return f
  }
  const verse = (scheme: 'ABAB' | 'AABB') => {
    const A = fam()
    const B = fam()
    const order = scheme === 'ABAB' ? [A, B, A, B] : [A, A, B, B]
    return order.map((f) => makeLine(c, VERSE, f))
  }
  const v1 = verse(r.chance(0.5) ? 'ABAB' : 'AABB')
  const v2 = verse(r.chance(0.5) ? 'ABAB' : 'AABB')
  const P = fam()
  const pre = [makeLine(c, PRE, P, 4, 9), makeLine(c, PRE, P, 4, 9)]
  const H = fam()
  const hook = makeHook(c, H)
  const C2 = fam()
  const chorusLines = [hook, makeLine(c, CHORUS, C2, 4, 10), r.chance(0.5) ? hook : makeLine(c, CHORUS, H, 4, 10), makeLine(c, CHORUS, C2, 4, 10)]
  const BR = fam()
  const bridge = [makeLine(c, BRIDGE, BR), makeLine(c, BRIDGE, BR)]
  if (r.chance(0.6)) {
    const BR2 = fam()
    bridge.push(makeLine(c, BRIDGE, BR2), makeLine(c, BRIDGE, BR2))
  }
  const outro = cap(fill(r.pick(OUTRO), c, ''))
  const usePre = r.chance(0.75)
  const parts: string[] = []
  parts.push('[Intro]')
  parts.push(`[Verse 1]\n${v1.join('\n')}`)
  if (usePre) parts.push(`[Pre-Chorus]\n${pre.join('\n')}`)
  parts.push(`[Chorus]\n${chorusLines.join('\n')}`)
  parts.push(`[Verse 2]\n${v2.join('\n')}`)
  if (usePre) parts.push(`[Pre-Chorus]\n${pre.join('\n')}`)
  parts.push(`[Chorus]\n${chorusLines.join('\n')}`)
  parts.push(`[Bridge]\n${bridge.join('\n')}`)
  parts.push(`[Chorus]\n${chorusLines.join('\n')}`)
  parts.push(`[Outro]\n${outro}`)
  // title: topic + the hook's rhyme word when it makes a nice phrase, else adjective + topic
  const lastWord = hook.replace(/[^A-Za-z' ]/g, ' ').trim().split(/\s+/).pop() ?? ''
  const nice = ['tonight', 'forever', 'again', 'away', 'alive', 'together', 'higher', 'free', 'home', 'fire', 'light', 'heart', 'gold', 'dreams', 'ocean', 'skyline', 'satellite', 'melody', 'gravity', 'song', 'sun', 'moon', 'young', 'wild', 'runaway']
  let ttl: string
  if (nice.includes(lastWord.toLowerCase()) && r.chance(0.7)) ttl = `${topic} ${lastWord}`
  else if (r.chance(0.5)) ttl = `${r.pick(th.a)} ${topic}`
  else ttl = topic
  return { title: title(ttl.trim()), lyrics: parts.join('\n\n') }
}
