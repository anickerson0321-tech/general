// Style prompt analysis: genre, tempo, key, mood, vocals, instrumentation.
import type { MusicalKey } from '../../types'
import { Rng } from './rng'

export type GenreId =
  | 'pop'
  | 'rock'
  | 'hiphop'
  | 'trap'
  | 'rnb'
  | 'edm'
  | 'synthwave'
  | 'lofi'
  | 'country'
  | 'folk'
  | 'jazz'
  | 'ballad'
  | 'metal'
  | 'punk'
  | 'reggae'
  | 'latin'
  | 'gospel'
  | 'kpop'
  | 'cinematic'

export type DrumKit = 'acoustic' | 'electronic' | '808' | 'lofi' | 'brush' | 'epic' | 'synthwave'
export type BassType = 'sub' | '808' | 'synth' | 'picked' | 'upright'
export type KeysType = 'piano' | 'epiano' | 'organ'
export type GuitarType = 'acoustic' | 'clean' | 'distorted' | 'skank' | 'nylon'
export type PadType = 'warm' | 'supersaw' | 'strings' | 'choir'
export type LeadType = 'saw' | 'square' | 'pluck' | 'bell' | 'flute' | 'steel' | 'sax' | 'guitar' | 'brass' | 'piano'

export interface InstrumentSet {
  drums: DrumKit | null
  bass: BassType | null
  keys: KeysType | null
  /** main rhythm guitar */
  guitar: GuitarType | null
  /** second guitar layer (e.g. distorted chorus guitar in rock) */
  guitar2: GuitarType | null
  pad: PadType | null
  strings: boolean
  brass: boolean
  choir: boolean
  lead: LeadType | null
  arp: boolean
  /** risers / impacts / transitions */
  fx: boolean
  /** vinyl crackle + tape wobble */
  vinyl: boolean
}

export interface StyleProfile {
  genre: GenreId
  /** display label of the detected genre (e.g. "synthwave") */
  genreLabel: string
  /** other genres mentioned in the prompt (flavour) */
  secondary: GenreId[]
  bpm: number
  bpmExplicit: boolean
  key: MusicalKey
  keyExplicit: boolean
  modeExplicit: boolean
  /** recognised mood words, e.g. ["dark", "dreamy"] */
  moods: string[]
  /** 0..1 overall intensity */
  energy: number
  /** -1 (sad/dark) .. 1 (happy/bright) */
  valence: number
  /** 0..1 tonal brightness (filters, voicing register) */
  brightness: number
  /** 0..1 reverb amount */
  reverb: number
  vocalGender: 'male' | 'female' | 'any'
  /** 0..1 breathy/soft vocal delivery */
  breathiness: number
  instruments: InstrumentSet
  /** instruments explicitly named in the prompt */
  namedInstruments: string[]
  /** 0 (straight) .. 1 (triplet swing) */
  swing: number
  halfTime: boolean
  /** four-on-the-floor sidechain pumping */
  sidechain: boolean
  /** elements removed because of excludeStyle */
  excluded: string[]
  /** display tags (before seed resolution of key/bpm) */
  tags: string[]
}

export interface GenreDef {
  id: GenreId
  label: string
  keywords: Array<[string, number]>
  bpm: [number, number]
  minorProb: number
  swing: number
  halfTime?: boolean
  sidechain?: boolean
  energy: number
  brightness: number
  reverb: number
  vocal: 'male' | 'female' | 'any'
  breathiness: number
  inst: InstrumentSet
}

const I = (o: Partial<InstrumentSet>): InstrumentSet => ({
  drums: null,
  bass: null,
  keys: null,
  guitar: null,
  guitar2: null,
  pad: null,
  strings: false,
  brass: false,
  choir: false,
  lead: null,
  arp: false,
  fx: false,
  vinyl: false,
  ...o,
})

export const GENRES: GenreDef[] = [
  {
    id: 'pop', label: 'pop',
    keywords: [['pop', 1], ['dance pop', 1.2], ['indie pop', 1.3], ['electropop', 1.2], ['bedroom pop', 1.2], ['dream pop', 1.2], ['radio', 0.4], ['catchy', 0.3], ['disco', 0.9], ['funk', 0.7]],
    bpm: [96, 122], minorProb: 0.35, swing: 0, energy: 0.65, brightness: 0.65, reverb: 0.45, vocal: 'any', breathiness: 0.25,
    inst: I({ drums: 'electronic', bass: 'synth', keys: 'piano', guitar: 'acoustic', pad: 'warm', lead: 'pluck', arp: true, fx: true }),
  },
  {
    id: 'rock', label: 'rock',
    keywords: [['rock', 1.2], ['indie rock', 1.4], ['alt rock', 1.4], ['alternative', 0.8], ['grunge', 1.3], ['garage', 1.0], ['arena', 0.5], ['power chords', 0.8], ['stadium', 0.6], ['classic rock', 1.4], ['pop rock', 1.3]],
    bpm: [104, 140], minorProb: 0.4, swing: 0, energy: 0.75, brightness: 0.6, reverb: 0.35, vocal: 'male', breathiness: 0.1,
    inst: I({ drums: 'acoustic', bass: 'picked', guitar: 'clean', guitar2: 'distorted', lead: 'guitar', fx: false }),
  },
  {
    id: 'hiphop', label: 'hip hop',
    keywords: [['hip hop', 1.2], ['hip-hop', 1.2], ['hiphop', 1.2], ['rap', 1.0], ['boom bap', 1.5], ['boombap', 1.5], ['old school', 0.6], ['90s rap', 1.4]],
    bpm: [84, 96], minorProb: 0.75, swing: 0.4, energy: 0.6, brightness: 0.45, reverb: 0.25, vocal: 'male', breathiness: 0.1,
    inst: I({ drums: 'acoustic', bass: 'sub', keys: 'piano', strings: false, lead: 'bell' }),
  },
  {
    id: 'trap', label: 'trap',
    keywords: [['trap', 1.6], ['drill', 1.4], ['808', 0.6], ['mumble', 0.8], ['phonk', 1.2], ['dark rap', 1.0]],
    bpm: [132, 150], minorProb: 0.92, swing: 0, halfTime: true, energy: 0.7, brightness: 0.4, reverb: 0.3, vocal: 'male', breathiness: 0.1,
    inst: I({ drums: '808', bass: '808', pad: 'warm', lead: 'bell', keys: null, fx: true }),
  },
  {
    id: 'rnb', label: 'r&b',
    keywords: [['r&b', 1.4], ['rnb', 1.4], ['r and b', 1.4], ['soul', 1.1], ['neo soul', 1.5], ['neo-soul', 1.5], ['motown', 1.2], ['slow jam', 1.3], ['quiet storm', 1.3]],
    bpm: [68, 94], minorProb: 0.5, swing: 0.3, energy: 0.5, brightness: 0.5, reverb: 0.4, vocal: 'female', breathiness: 0.35,
    inst: I({ drums: 'electronic', bass: 'sub', keys: 'epiano', pad: 'warm' }),
  },
  {
    id: 'edm', label: 'edm',
    keywords: [['edm', 1.5], ['house', 1.3], ['deep house', 1.5], ['progressive house', 1.5], ['techno', 1.3], ['trance', 1.4], ['dance', 0.8], ['club', 0.8], ['electronic', 0.6], ['future bass', 1.4], ['big room', 1.4], ['festival', 0.7], ['tropical house', 1.5], ['dubstep', 1.0], ['drum and bass', 0.9]],
    bpm: [120, 128], minorProb: 0.7, swing: 0, sidechain: true, energy: 0.8, brightness: 0.7, reverb: 0.45, vocal: 'female', breathiness: 0.25,
    inst: I({ drums: 'electronic', bass: 'synth', pad: 'supersaw', keys: 'piano', lead: 'pluck', arp: true, fx: true }),
  },
  {
    id: 'synthwave', label: 'synthwave',
    keywords: [['synthwave', 1.8], ['retrowave', 1.8], ['outrun', 1.8], ['80s', 1.0], ['eighties', 1.0], ['synth pop', 1.2], ['synthpop', 1.2], ['chillwave', 1.5], ['darkwave', 1.5], ['new wave', 1.2], ['vaporwave', 1.3], ['retro', 0.5], ['neon', 0.5]],
    bpm: [84, 118], minorProb: 0.8, swing: 0, energy: 0.65, brightness: 0.6, reverb: 0.7, vocal: 'any', breathiness: 0.3,
    inst: I({ drums: 'synthwave', bass: 'synth', pad: 'warm', lead: 'saw', arp: true, fx: true }),
  },
  {
    id: 'lofi', label: 'lofi',
    keywords: [['lofi', 1.8], ['lo-fi', 1.8], ['lo fi', 1.8], ['chillhop', 1.8], ['study', 0.8], ['jazzy hip hop', 1.6], ['chill', 0.6], ['cozy', 0.5], ['bedroom', 0.3]],
    bpm: [70, 88], minorProb: 0.5, swing: 0.5, energy: 0.35, brightness: 0.3, reverb: 0.4, vocal: 'any', breathiness: 0.45,
    inst: I({ drums: 'lofi', bass: 'sub', keys: 'epiano', guitar: null, vinyl: true }),
  },
  {
    id: 'country', label: 'country',
    keywords: [['country', 1.5], ['nashville', 1.3], ['americana', 1.1], ['bluegrass', 1.3], ['honky tonk', 1.4], ['southern', 0.6], ['western', 0.7], ['twang', 1.0]],
    bpm: [84, 120], minorProb: 0.15, swing: 0.1, energy: 0.6, brightness: 0.6, reverb: 0.3, vocal: 'male', breathiness: 0.1,
    inst: I({ drums: 'acoustic', bass: 'picked', guitar: 'acoustic', keys: 'piano', lead: 'steel' }),
  },
  {
    id: 'folk', label: 'folk',
    keywords: [['folk', 1.5], ['acoustic', 0.9], ['singer-songwriter', 1.3], ['singer songwriter', 1.3], ['indie folk', 1.6], ['campfire', 1.0], ['fingerpicked', 1.0], ['celtic', 1.0], ['unplugged', 1.0]],
    bpm: [76, 112], minorProb: 0.3, swing: 0.05, energy: 0.4, brightness: 0.55, reverb: 0.4, vocal: 'any', breathiness: 0.3,
    inst: I({ drums: 'acoustic', bass: 'upright', guitar: 'acoustic', strings: true, lead: 'flute' }),
  },
  {
    id: 'jazz', label: 'jazz',
    keywords: [['jazz', 1.6], ['swing', 0.6], ['bebop', 1.6], ['big band', 1.3], ['bossa', 1.0], ['lounge', 1.0], ['smooth jazz', 1.6], ['jazzy', 0.8], ['noir', 0.7], ['crooner', 1.0]],
    bpm: [96, 150], minorProb: 0.4, swing: 0.7, energy: 0.45, brightness: 0.5, reverb: 0.35, vocal: 'any', breathiness: 0.25,
    inst: I({ drums: 'brush', bass: 'upright', keys: 'piano', lead: 'sax' }),
  },
  {
    id: 'ballad', label: 'piano ballad',
    keywords: [['ballad', 1.0], ['piano ballad', 1.8], ['power ballad', 1.4], ['piano', 0.5], ['torch song', 1.3], ['emotional', 0.3]],
    bpm: [62, 80], minorProb: 0.3, swing: 0, energy: 0.4, brightness: 0.5, reverb: 0.55, vocal: 'any', breathiness: 0.3,
    inst: I({ drums: 'acoustic', bass: 'sub', keys: 'piano', strings: true, pad: null }),
  },
  {
    id: 'metal', label: 'metal',
    keywords: [['metal', 1.7], ['heavy metal', 1.8], ['metalcore', 1.8], ['thrash', 1.6], ['djent', 1.6], ['doom', 1.0], ['hardcore', 1.0], ['nu metal', 1.8], ['shred', 1.0], ['headbang', 1.0]],
    bpm: [140, 176], minorProb: 1, swing: 0, energy: 0.95, brightness: 0.55, reverb: 0.3, vocal: 'male', breathiness: 0,
    inst: I({ drums: 'acoustic', bass: 'picked', guitar: 'distorted', guitar2: 'distorted', lead: 'guitar' }),
  },
  {
    id: 'punk', label: 'punk',
    keywords: [['punk', 1.7], ['pop punk', 1.9], ['pop-punk', 1.9], ['skate', 1.0], ['emo', 1.1], ['ska', 0.8]],
    bpm: [158, 188], minorProb: 0.2, swing: 0, energy: 0.9, brightness: 0.6, reverb: 0.25, vocal: 'male', breathiness: 0,
    inst: I({ drums: 'acoustic', bass: 'picked', guitar: 'distorted', guitar2: 'distorted' }),
  },
  {
    id: 'reggae', label: 'reggae',
    keywords: [['reggae', 1.8], ['dub', 1.2], ['dancehall', 1.2], ['roots', 0.8], ['island', 0.6], ['rocksteady', 1.6], ['one drop', 1.6]],
    bpm: [68, 84], minorProb: 0.35, swing: 0.2, energy: 0.5, brightness: 0.5, reverb: 0.4, vocal: 'male', breathiness: 0.1,
    inst: I({ drums: 'acoustic', bass: 'sub', guitar: 'skank', keys: 'organ', brass: false, lead: 'brass' }),
  },
  {
    id: 'latin', label: 'reggaeton',
    keywords: [['reggaeton', 1.9], ['latin', 1.4], ['latin pop', 1.6], ['dembow', 1.9], ['urbano', 1.5], ['bachata', 1.3], ['salsa', 1.0], ['cumbia', 1.2], ['moombahton', 1.5], ['perreo', 1.6], ['spanish', 0.6]],
    bpm: [88, 100], minorProb: 0.8, swing: 0, energy: 0.7, brightness: 0.6, reverb: 0.35, vocal: 'any', breathiness: 0.15,
    inst: I({ drums: '808', bass: 'sub', guitar: 'nylon', pad: 'warm', lead: 'pluck', fx: true }),
  },
  {
    id: 'gospel', label: 'gospel',
    keywords: [['gospel', 1.8], ['church', 1.2], ['worship', 1.3], ['praise', 1.0], ['spiritual', 0.8], ['hymn', 1.2], ['choir', 0.6]],
    bpm: [70, 100], minorProb: 0.2, swing: 0.3, energy: 0.6, brightness: 0.55, reverb: 0.5, vocal: 'any', breathiness: 0.1,
    inst: I({ drums: 'acoustic', bass: 'synth', keys: 'organ', choir: true }),
  },
  {
    id: 'kpop', label: 'k-pop',
    keywords: [['k-pop', 2], ['kpop', 2], ['k pop', 2], ['j-pop', 1.8], ['jpop', 1.8], ['idol', 1.2], ['anime', 1.0], ['city pop', 1.2]],
    bpm: [104, 128], minorProb: 0.5, swing: 0, energy: 0.8, brightness: 0.75, reverb: 0.4, vocal: 'female', breathiness: 0.2,
    inst: I({ drums: 'electronic', bass: 'synth', pad: 'supersaw', keys: 'piano', lead: 'pluck', arp: true, fx: true }),
  },
  {
    id: 'cinematic', label: 'cinematic',
    keywords: [['cinematic', 1.8], ['orchestral', 1.8], ['orchestra', 1.6], ['epic', 0.6], ['film score', 1.8], ['soundtrack', 1.5], ['trailer', 1.5], ['score', 0.8], ['symphonic', 1.6], ['ambient', 0.9], ['fantasy', 0.7], ['heroic', 0.8]],
    bpm: [72, 100], minorProb: 0.75, swing: 0, energy: 0.6, brightness: 0.5, reverb: 0.8, vocal: 'female', breathiness: 0.25,
    inst: I({ drums: 'epic', bass: 'sub', keys: 'piano', pad: 'strings', strings: true, brass: true, choir: true, fx: true }),
  },
]

export const GENRE_BY_ID: Record<GenreId, GenreDef> = Object.fromEntries(GENRES.map((g) => [g.id, g])) as Record<GenreId, GenreDef>

interface MoodDef {
  words: string[]
  energy: number
  valence: number
  bright: number
  reverb: number
  minor: number // + pushes to minor
  breath?: number
}

const MOODS: Record<string, MoodDef> = {
  happy: { words: ['happy', 'joyful', 'cheerful', 'fun', 'playful', 'sunny', 'bright', 'feel good', 'feel-good', 'carefree'], energy: 0.1, valence: 0.6, bright: 0.15, reverb: 0, minor: -0.4 },
  upbeat: { words: ['upbeat', 'energetic', 'driving', 'bouncy', 'groovy', 'lively', 'uptempo', 'party', 'hype'], energy: 0.25, valence: 0.3, bright: 0.1, reverb: -0.05, minor: -0.15 },
  sad: { words: ['sad', 'melancholic', 'melancholy', 'heartbreak', 'heartbroken', 'lonely', 'sorrow', 'tearful', 'blue', 'bittersweet', 'longing', 'emotional'], energy: -0.15, valence: -0.6, bright: -0.1, reverb: 0.1, minor: 0.45, breath: 0.1 },
  dark: { words: ['dark', 'sinister', 'ominous', 'menacing', 'gritty', 'haunting', 'eerie', 'moody', 'brooding', 'gothic', 'evil'], energy: 0.05, valence: -0.5, bright: -0.2, reverb: 0.1, minor: 0.6 },
  epic: { words: ['epic', 'anthemic', 'triumphant', 'majestic', 'heroic', 'soaring', 'powerful', 'massive', 'huge'], energy: 0.25, valence: 0.2, bright: 0.1, reverb: 0.2, minor: 0.1 },
  dreamy: { words: ['dreamy', 'ethereal', 'atmospheric', 'floaty', 'hazy', 'airy', 'shimmering', 'lush', 'spacey', 'celestial', 'nostalgic', 'wistful'], energy: -0.1, valence: 0.05, bright: 0, reverb: 0.3, minor: 0.1, breath: 0.2 },
  chill: { words: ['chill', 'relaxed', 'mellow', 'laid back', 'laid-back', 'calm', 'gentle', 'peaceful', 'smooth', 'cozy', 'intimate', 'lazy'], energy: -0.25, valence: 0.1, bright: -0.1, reverb: 0.05, minor: 0, breath: 0.2 },
  aggressive: { words: ['aggressive', 'angry', 'intense', 'heavy', 'hard-hitting', 'fierce', 'raw', 'brutal', 'furious', 'rage'], energy: 0.3, valence: -0.3, bright: 0.05, reverb: -0.1, minor: 0.4 },
  romantic: { words: ['romantic', 'love', 'sensual', 'tender', 'sweet', 'sultry', 'passionate'], energy: -0.05, valence: 0.3, bright: 0, reverb: 0.05, minor: -0.1, breath: 0.15 },
  hopeful: { words: ['hopeful', 'uplifting', 'inspiring', 'inspirational', 'optimistic', 'euphoric', 'triumphant', 'free'], energy: 0.15, valence: 0.5, bright: 0.15, reverb: 0.1, minor: -0.3 },
  slow: { words: ['slow', 'downtempo', 'ballad'], energy: -0.2, valence: 0, bright: 0, reverb: 0.05, minor: 0 },
  fast: { words: ['fast', 'rapid', 'frantic', 'speedy'], energy: 0.2, valence: 0, bright: 0, reverb: -0.05, minor: 0 },
}

function hasWord(text: string, w: string): boolean {
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`, 'i').test(text)
}

const NOTE_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

function parseKey(t: string): { key: MusicalKey | null; mode: 'major' | 'minor' | null } {
  const m = t.match(/(?:^|[^a-z])(?:in\s+|key\s+of\s+)?([a-g])\s*(#|♯|b|♭|sharp|flat)?\s*(major|minor|maj|min)(?:$|[^a-z])/i)
  if (m) {
    let pc = NOTE_PC[m[1].toLowerCase()]
    const acc = (m[2] ?? '').toLowerCase()
    if (acc === '#' || acc === '♯' || acc === 'sharp') pc += 1
    if (acc === 'b' || acc === '♭' || acc === 'flat') pc -= 1
    const mode = m[3].toLowerCase().startsWith('min') ? 'minor' : 'major'
    return { key: { tonic: ((pc % 12) + 12) % 12, mode }, mode }
  }
  const k2 = t.match(/key\s+of\s+([a-g])\s*(#|b)?(m)?(?:$|[^a-z])/i)
  if (k2) {
    let pc = NOTE_PC[k2[1].toLowerCase()]
    if (k2[2] === '#') pc += 1
    if (k2[2] === 'b') pc -= 1
    const mode = k2[3] ? 'minor' : 'major'
    return { key: { tonic: ((pc % 12) + 12) % 12, mode }, mode }
  }
  if (/minor key|in minor|\bminor\b/.test(t)) return { key: null, mode: 'minor' }
  if (/major key|in major|\bmajor\b/.test(t)) return { key: null, mode: 'major' }
  return { key: null, mode: null }
}

interface InstMention {
  words: string[]
  name: string
  apply: (s: InstrumentSet, g: GenreId) => void
}

const ROCKISH: GenreId[] = ['rock', 'metal', 'punk']

const INST_MENTIONS: InstMention[] = [
  { words: ['electric piano', 'rhodes', 'wurlitzer', 'wurli', 'e-piano', 'epiano'], name: 'rhodes', apply: (s) => (s.keys = 'epiano') },
  { words: ['organ', 'hammond', 'b3'], name: 'organ', apply: (s) => (s.keys = 'organ') },
  { words: ['piano', 'keys', 'grand piano'], name: 'piano', apply: (s) => { if (s.keys !== 'epiano' && s.keys !== 'organ') s.keys = 'piano' } },
  { words: ['acoustic guitar', 'fingerpicked', 'fingerpicking', 'strummed', 'strumming'], name: 'acoustic guitar', apply: (s) => (s.guitar = 'acoustic') },
  { words: ['nylon', 'spanish guitar', 'classical guitar', 'flamenco'], name: 'nylon guitar', apply: (s) => (s.guitar = 'nylon') },
  { words: ['distorted guitar', 'heavy guitar', 'power chords', 'riffs', 'shredding', 'overdrive', 'fuzz', 'distortion'], name: 'distorted guitar', apply: (s) => { s.guitar2 = 'distorted'; if (!s.guitar) s.guitar = 'clean' } },
  { words: ['electric guitar', 'clean guitar', 'jangly', 'jangle', 'twangy guitar', 'surf guitar'], name: 'electric guitar', apply: (s) => { if (s.guitar !== 'distorted') s.guitar = 'clean' } },
  { words: ['guitar', 'guitars'], name: 'guitar', apply: (s, g) => { if (!s.guitar) s.guitar = ROCKISH.includes(g) ? 'distorted' : 'acoustic' } },
  { words: ['808', '808s'], name: '808', apply: (s) => { s.bass = '808'; if (s.drums !== 'acoustic' && s.drums !== 'brush') s.drums = '808' } },
  { words: ['sub bass', 'sub-bass'], name: 'sub bass', apply: (s) => (s.bass = 'sub') },
  { words: ['bass guitar', 'slap bass', 'funky bass', 'electric bass'], name: 'bass guitar', apply: (s) => (s.bass = 'picked') },
  { words: ['upright bass', 'double bass', 'acoustic bass', 'walking bass', 'contrabass'], name: 'upright bass', apply: (s) => (s.bass = 'upright') },
  { words: ['synth bass', 'bassline', 'acid'], name: 'synth bass', apply: (s) => (s.bass = 'synth') },
  { words: ['supersaw', 'supersaws', 'big synths', 'trance synths'], name: 'supersaw', apply: (s) => (s.pad = 'supersaw') },
  { words: ['arp', 'arps', 'arpeggio', 'arpeggios', 'arpeggiated', 'sequencer'], name: 'arpeggios', apply: (s) => (s.arp = true) },
  { words: ['synth', 'synths', 'synthesizer', 'analog synth', 'pads', 'pad'], name: 'synths', apply: (s) => { if (!s.pad) s.pad = 'warm'; if (!s.lead) s.lead = 'saw' } },
  { words: ['strings', 'violin', 'violins', 'cello', 'cellos', 'viola', 'string section', 'orchestral strings', 'orchestra'], name: 'strings', apply: (s) => (s.strings = true) },
  { words: ['brass', 'horns', 'horn section', 'trumpet', 'trumpets', 'trombone', 'french horn'], name: 'brass', apply: (s) => { s.brass = true; if (s.lead === null || s.lead === 'pluck') s.lead = 'brass' } },
  { words: ['sax', 'saxophone', 'tenor sax', 'alto sax'], name: 'saxophone', apply: (s) => (s.lead = 'sax') },
  { words: ['flute', 'pan flute', 'whistle', 'recorder', 'ocarina'], name: 'flute', apply: (s) => (s.lead = 'flute') },
  { words: ['pedal steel', 'steel guitar', 'slide guitar', 'dobro', 'lap steel'], name: 'pedal steel', apply: (s) => (s.lead = 'steel') },
  { words: ['bells', 'bell', 'glockenspiel', 'music box', 'celesta', 'chimes', 'marimba', 'vibraphone', 'kalimba'], name: 'bells', apply: (s) => (s.lead = 'bell') },
  { words: ['choir', 'choral', 'gospel choir', 'chant', 'chants'], name: 'choir', apply: (s) => (s.choir = true) },
  { words: ['lead synth', 'synth lead', 'lead'], name: 'synth lead', apply: (s) => (s.lead = 'saw') },
  { words: ['guitar solo', 'solo guitar', 'lead guitar'], name: 'guitar solo', apply: (s) => (s.lead = 'guitar') },
  { words: ['drum machine', 'electronic drums', '909', '707', 'linndrum'], name: 'drum machine', apply: (s) => (s.drums = s.drums === 'synthwave' ? 'synthwave' : 'electronic') },
  { words: ['live drums', 'acoustic drums', 'drum kit', 'drummer'], name: 'live drums', apply: (s) => (s.drums = 'acoustic') },
  { words: ['brushes', 'brush drums'], name: 'brushes', apply: (s) => (s.drums = 'brush') },
  { words: ['taiko', 'timpani', 'war drums', 'epic drums', 'percussion ensemble'], name: 'epic percussion', apply: (s) => (s.drums = 'epic') },
  { words: ['gated reverb', 'gated drums'], name: 'gated drums', apply: (s) => (s.drums = 'synthwave') },
  { words: ['vinyl', 'crackle', 'tape', 'cassette', 'dusty'], name: 'vinyl', apply: (s) => (s.vinyl = true) },
  { words: ['risers', 'riser', 'drop', 'build up', 'buildup'], name: 'fx', apply: (s) => (s.fx = true) },
]

interface ExcludeRule {
  words: string[]
  apply: (s: InstrumentSet) => void
}

const EXCLUDES: ExcludeRule[] = [
  { words: ['drums', 'drum', 'percussion', 'beat', 'beats', 'kick'], apply: (s) => (s.drums = null) },
  { words: ['808', '808s'], apply: (s) => { if (s.bass === '808') s.bass = 'sub'; if (s.drums === '808') s.drums = 'electronic' } },
  { words: ['bass'], apply: (s) => (s.bass = null) },
  { words: ['piano', 'keys', 'keyboard'], apply: (s) => { s.keys = null; if (s.lead === 'piano') s.lead = null } },
  { words: ['rhodes', 'electric piano'], apply: (s) => { if (s.keys === 'epiano') s.keys = 'piano' } },
  { words: ['organ'], apply: (s) => { if (s.keys === 'organ') s.keys = 'piano' } },
  { words: ['guitar', 'guitars'], apply: (s) => { s.guitar = null; s.guitar2 = null; if (s.lead === 'guitar' || s.lead === 'steel') s.lead = 'saw' } },
  { words: ['distorted guitar', 'distortion', 'heavy guitar'], apply: (s) => { if (s.guitar === 'distorted') s.guitar = 'clean'; if (s.guitar2 === 'distorted') s.guitar2 = null } },
  { words: ['synth', 'synths', 'synthesizer', 'electronic'], apply: (s) => { if (s.pad === 'warm' || s.pad === 'supersaw') s.pad = s.strings ? null : 'strings'; if (s.lead === 'saw' || s.lead === 'square' || s.lead === 'pluck') s.lead = 'piano'; s.arp = false; if (s.bass === 'synth') s.bass = 'picked'; if (s.drums === 'electronic' || s.drums === 'synthwave' || s.drums === '808') s.drums = 'acoustic' } },
  { words: ['strings', 'violin', 'cello', 'orchestra'], apply: (s) => { s.strings = false; if (s.pad === 'strings') s.pad = 'warm' } },
  { words: ['brass', 'horns', 'trumpet'], apply: (s) => { s.brass = false; if (s.lead === 'brass') s.lead = null } },
  { words: ['sax', 'saxophone'], apply: (s) => { if (s.lead === 'sax') s.lead = 'piano' } },
  { words: ['choir'], apply: (s) => (s.choir = false) },
  { words: ['arp', 'arps', 'arpeggio', 'arpeggios'], apply: (s) => (s.arp = false) },
  { words: ['pad', 'pads'], apply: (s) => (s.pad = null) },
  { words: ['lead', 'solo', 'solos'], apply: (s) => (s.lead = null) },
  { words: ['vinyl', 'crackle', 'noise'], apply: (s) => (s.vinyl = false) },
  { words: ['risers', 'fx', 'effects'], apply: (s) => (s.fx = false) },
]

/** Analyse a free-text style prompt (plus optional exclusions) into a StyleProfile. Deterministic. */
export function analyzeStyle(style: string, exclude?: string): StyleProfile {
  const t = ` ${(style ?? '').toLowerCase().replace(/[_]/g, ' ')} `
  const ex = ` ${(exclude ?? '').toLowerCase()} `
  // ------------------------------------------------ genre scoring
  const scores = new Map<GenreId, number>()
  for (const g of GENRES) {
    let s = 0
    for (const [kw, w] of g.keywords) {
      if (hasWord(t, kw)) {
        const pos = t.indexOf(kw) / Math.max(1, t.length)
        s += w * (1.15 - 0.3 * pos)
      }
      if (hasWord(ex, kw)) s -= 3 * w
    }
    scores.set(g.id, s)
  }
  // disambiguation tweaks
  const sc = (id: GenreId) => scores.get(id) ?? 0
  if (sc('lofi') > 0 && sc('hiphop') > 0) scores.set('hiphop', sc('hiphop') * 0.4)
  if (sc('trap') > 0 && sc('hiphop') > 0) scores.set('hiphop', sc('hiphop') * 0.5)
  if (sc('kpop') > 0) scores.set('pop', sc('pop') * 0.3)
  if (sc('punk') > 0 && sc('pop') > 0) scores.set('pop', sc('pop') * 0.3)
  if (sc('folk') > 0 && sc('ballad') > 0) scores.set('ballad', sc('ballad') * 0.5)
  if (sc('rock') > 0 && sc('pop') > 0 && hasWord(t, 'pop rock')) scores.set('pop', sc('pop') * 0.4)
  if (sc('metal') > 0 && sc('rock') > 0) scores.set('rock', sc('rock') * 0.5)
  if (sc('synthwave') > 0 && sc('pop') > 0) scores.set('pop', sc('pop') * 0.6)
  if (sc('rnb') > 0 && sc('pop') > 0 && sc('rnb') >= sc('pop') * 0.8) scores.set('pop', sc('pop') * 0.6)
  const ranked = [...scores.entries()].filter(([, s]) => s > 0.05).sort((a, b) => b[1] - a[1])
  const genre: GenreId = ranked.length ? ranked[0][0] : 'pop'
  const secondary = ranked.slice(1, 3).filter(([, s]) => s >= ranked[0][1] * 0.55).map(([g]) => g)
  const def = GENRE_BY_ID[genre]
  // ------------------------------------------------ moods
  const moods: string[] = []
  let energy = def.energy
  let valence = 0
  let bright = def.brightness
  let reverb = def.reverb
  let minorP = def.minorProb
  let breath = def.breathiness
  for (const [name, m] of Object.entries(MOODS)) {
    if (m.words.some((w) => hasWord(t, w))) {
      moods.push(name)
      energy += m.energy
      valence += m.valence
      bright += m.bright
      reverb += m.reverb
      minorP += m.minor
      breath += m.breath ?? 0
    }
  }
  // ------------------------------------------------ tempo
  let bpm = Math.round((def.bpm[0] + def.bpm[1]) / 2)
  let bpmExplicit = false
  const bm = t.match(/(\d{2,3}(?:\.\d+)?)\s*-?\s*bpm/) ?? t.match(/bpm\s*:?\s*(\d{2,3})/) ?? t.match(/tempo\s*:?\s*(\d{2,3})/)
  if (bm) {
    const v = parseFloat(bm[1])
    if (v >= 40 && v <= 240) {
      bpm = Math.round(v)
      bpmExplicit = true
    }
  }
  if (!bpmExplicit) {
    if (moods.includes('slow')) bpm = Math.round(def.bpm[0] - 4)
    else if (moods.includes('fast')) bpm = Math.round(def.bpm[1] + 6)
    else if (moods.includes('upbeat')) bpm = Math.round(def.bpm[0] * 0.3 + def.bpm[1] * 0.7)
    else if (moods.includes('chill')) bpm = Math.round(def.bpm[0] * 0.7 + def.bpm[1] * 0.3)
  }
  let halfTime = !!def.halfTime
  if (hasWord(t, 'half time') || hasWord(t, 'half-time') || hasWord(t, 'halftime')) halfTime = true
  if (hasWord(t, 'double time')) halfTime = false
  // ------------------------------------------------ key
  const pk = parseKey(t)
  const mode: 'major' | 'minor' = pk.mode ?? (minorP >= 0.5 ? 'minor' : 'major')
  const key: MusicalKey = pk.key ?? { tonic: mode === 'minor' ? 9 : 0, mode }
  // ------------------------------------------------ vocals
  let vocalGender: 'male' | 'female' | 'any' = def.vocal
  const fem = /\b(female|woman|women|girl|girls|she|her|soprano|alto|diva|feminine)\b/.test(t)
  const mal = /\b(male|man|men|boy|boys|he|his|baritone|tenor|bass voice|masculine)\b/.test(t.replace(/female/g, ''))
  if (fem && !mal) vocalGender = 'female'
  else if (mal && !fem) vocalGender = 'male'
  else if (fem && mal) vocalGender = 'any'
  if (/\bfemale\b/.test(ex) && vocalGender !== 'male') vocalGender = 'male'
  else if (/\bmale\b/.test(ex.replace(/female/g, '')) && vocalGender !== 'female') vocalGender = 'female'
  if (/\b(breathy|whisper|whispered|soft vocals|airy vocals|falsetto)\b/.test(t)) breath += 0.3
  if (/\b(belting|powerful vocals|raspy|gritty vocals|shouted|screamed)\b/.test(t)) breath -= 0.2
  // ------------------------------------------------ instruments
  const inst: InstrumentSet = { ...def.inst }
  const named: string[] = []
  for (const im of INST_MENTIONS) {
    if (im.words.some((w) => hasWord(t, w))) {
      if (im.name === 'guitar' && named.some((n) => n.includes('guitar'))) continue
      if (im.name === 'piano' && named.includes('rhodes')) continue
      if (im.name === 'synths' && (named.includes('supersaw') || named.includes('synth bass'))) {
        if (!inst.pad) inst.pad = 'warm'
        continue
      }
      im.apply(inst, genre)
      named.push(im.name)
    }
  }
  if (/\b(no drums|without drums|drumless|a cappella|acapella)\b/.test(t)) inst.drums = null
  if (hasWord(t, 'acoustic') && !named.includes('acoustic guitar') && (genre === 'pop' || genre === 'rock' || genre === 'ballad' || genre === 'rnb')) {
    if (!inst.guitar || inst.guitar === 'clean') inst.guitar = 'acoustic'
    if (inst.guitar2 === 'distorted' && genre !== 'rock') inst.guitar2 = null
    if (inst.drums === 'electronic') inst.drums = 'acoustic'
    if (inst.bass === 'synth') inst.bass = 'picked'
    if (inst.pad === 'supersaw') inst.pad = 'warm'
    if (inst.lead === 'pluck') inst.lead = null
    inst.arp = false
  }
  const excluded: string[] = []
  for (const r of EXCLUDES) {
    const hit = r.words.find((w) => hasWord(ex, w))
    if (hit) {
      r.apply(inst)
      excluded.push(hit)
    }
  }
  let sidechain = !!def.sidechain
  if (hasWord(t, 'sidechain') || hasWord(t, 'pumping') || hasWord(t, 'four on the floor')) sidechain = true
  const swing = clamp01(def.swing + (hasWord(t, 'swing') || hasWord(t, 'swung') || hasWord(t, 'shuffle') ? 0.35 : 0) - (hasWord(t, 'straight') ? 1 : 0))
  // ------------------------------------------------ tags
  const tags: string[] = [def.label]
  for (const g of secondary) if (GENRE_BY_ID[g].label !== def.label && tags.length < 2) tags.push(GENRE_BY_ID[g].label)
  if (vocalGender !== 'any') tags.push(`${vocalGender} vocals`)
  for (const m of moods) if (m !== 'slow' && m !== 'fast') tags.push(m)
  for (const n of named.slice(0, 3)) tags.push(n)
  return {
    genre,
    genreLabel: def.label,
    secondary,
    bpm,
    bpmExplicit,
    key,
    keyExplicit: !!pk.key,
    modeExplicit: !!pk.mode,
    moods,
    energy: clamp01(energy),
    valence: Math.max(-1, Math.min(1, valence)),
    brightness: clamp01(bright),
    reverb: clamp01(reverb),
    vocalGender,
    breathiness: clamp01(breath),
    instruments: inst,
    namedInstruments: named,
    swing,
    halfTime,
    sidechain,
    excluded,
    tags,
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

// ------------------------------------------------------------------ suggestions
interface Suggest {
  g: string[]
  moods: string[]
  details: string[]
  bpm?: [number, number]
  vox?: string[]
}

const SUGGEST: Suggest[] = [
  { g: ['synthwave', '80s synthwave', 'retrowave', 'outrun synthwave'], moods: ['dreamy', 'nostalgic', 'neon-soaked', 'driving'], details: ['shimmering arpeggios', 'gated drums', 'warm analog pads', 'saw lead'], bpm: [90, 116] },
  { g: ['dark trap', 'melodic trap', 'trap'], moods: ['dark', 'moody', 'menacing', 'atmospheric'], details: ['heavy 808s', 'rolling hi-hats', 'eerie bells', 'ambient pads'], bpm: [136, 148], vox: ['male vocals', 'auto-tuned male vocals'] },
  { g: ['lofi hip hop', 'lo-fi chillhop'], moods: ['chill', 'cozy', 'nostalgic', 'rainy'], details: ['vinyl crackle', 'dusty rhodes', 'swung drums', 'soft upright bass'], bpm: [72, 86] },
  { g: ['indie pop', 'dance pop', 'bedroom pop', 'pop'], moods: ['upbeat', 'euphoric', 'bittersweet', 'catchy', 'dreamy'], details: ['big claps', 'bright synth plucks', 'acoustic guitar', 'punchy bass'], bpm: [100, 122] },
  { g: ['acoustic folk', 'indie folk', 'folk ballad'], moods: ['warm', 'wistful', 'intimate', 'hopeful'], details: ['fingerpicked guitar', 'soft strings', 'stomps and claps', 'flute'], bpm: [80, 108] },
  { g: ['piano ballad', 'power ballad'], moods: ['emotional', 'melancholic', 'hopeful', 'tender'], details: ['grand piano', 'lush strings', 'slow build'], bpm: [64, 78] },
  { g: ['deep house', 'progressive house', 'edm', 'future bass'], moods: ['euphoric', 'uplifting', 'energetic', 'dreamy'], details: ['supersaw drop', 'sidechained pads', 'risers', 'piano chords'], bpm: [120, 128] },
  { g: ['alt rock', 'indie rock', 'pop rock', 'garage rock'], moods: ['anthemic', 'raw', 'driving', 'energetic'], details: ['distorted guitars', 'live drums', 'big chorus', 'jangly guitar'], bpm: [108, 140], vox: ['male vocals', 'female vocals', 'raspy male vocals'] },
  { g: ['neo soul', 'r&b', 'slow jam r&b'], moods: ['smooth', 'sultry', 'romantic', 'mellow'], details: ['warm rhodes', 'finger snaps', 'sub bass', 'lush chords'], bpm: [70, 92] },
  { g: ['country', 'modern country', 'americana'], moods: ['heartfelt', 'upbeat', 'nostalgic', 'feel-good'], details: ['pedal steel', 'acoustic guitar', 'twangy guitar', 'piano'], bpm: [84, 116], vox: ['male vocals', 'female vocals', 'warm male vocals'] },
  { g: ['smooth jazz', 'jazz', 'late night jazz'], moods: ['smoky', 'mellow', 'romantic', 'playful'], details: ['brushes', 'upright bass', 'saxophone', 'swing'], bpm: [96, 140] },
  { g: ['heavy metal', 'metalcore', 'thrash metal'], moods: ['aggressive', 'epic', 'intense', 'dark'], details: ['palm-muted riffs', 'double kick', 'guitar solo'], bpm: [146, 176], vox: ['male vocals', 'powerful male vocals'] },
  { g: ['pop punk', 'punk rock', 'skate punk'], moods: ['energetic', 'angsty', 'fun', 'fast'], details: ['power chords', 'fast drums', 'gang vocals'], bpm: [160, 186] },
  { g: ['roots reggae', 'reggae', 'dub reggae'], moods: ['laid-back', 'sunny', 'positive', 'groovy'], details: ['offbeat skank guitar', 'one drop', 'organ bubble', 'deep bass'], bpm: [70, 82] },
  { g: ['reggaeton', 'latin pop', 'reggaeton romántico'], moods: ['sensual', 'party', 'summer', 'groovy'], details: ['dembow beat', 'nylon guitar', 'plucky synths', 'deep 808'], bpm: [88, 98] },
  { g: ['gospel', 'gospel soul', 'worship'], moods: ['uplifting', 'joyful', 'powerful', 'hopeful'], details: ['hammond organ', 'choir', 'hand claps', 'piano runs'], bpm: [72, 98] },
  { g: ['k-pop', 'j-pop', 'k-pop dance'], moods: ['bright', 'energetic', 'catchy', 'dreamy'], details: ['sparkly synths', 'punchy drums', 'big chorus', 'synth bass'], bpm: [106, 126], vox: ['female vocals', 'male vocals'] },
  { g: ['epic cinematic', 'orchestral', 'cinematic trailer'], moods: ['epic', 'heroic', 'majestic', 'haunting'], details: ['soaring strings', 'taiko drums', 'brass', 'choir'], bpm: [76, 96] },
  { g: ['boom bap hip hop', '90s hip hop'], moods: ['gritty', 'nostalgic', 'confident', 'chill'], details: ['dusty piano loop', 'hard snare', 'swing'], bpm: [86, 94], vox: ['male vocals'] },
]

const VOX = ['female vocals', 'male vocals', 'breathy female vocals', 'soulful male vocals', 'airy female vocals', 'warm male vocals']

/** A random, musically coherent style prompt ("dice" button). */
export function suggestStyles(seed: number): string {
  const r = new Rng(seed ^ 0x51ed)
  const s = r.pick(SUGGEST)
  const parts: string[] = []
  const mood = r.pick(s.moods)
  const g = r.pick(s.g)
  parts.push(r.chance(0.5) ? `${mood} ${g}` : g)
  const ds = r.shuffle(s.details.slice()).slice(0, r.int(1, 2))
  if (!parts[0].includes(mood)) parts.push(mood)
  parts.push(...ds)
  parts.push(r.pick(s.vox ?? VOX))
  if (s.bpm && r.chance(0.45)) parts.push(`${r.int(s.bpm[0], s.bpm[1])} bpm`)
  return parts.join(', ')
}
