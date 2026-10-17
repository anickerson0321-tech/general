// Genre-aware chord progressions per section type, with weirdness substitutions.
import type { GenreId } from './style'
import type { MotifKey } from './model'
import type { Rng } from './rng'

type Prog = string
interface ProgSet {
  verse: Prog[]
  chorus: Prog[]
  pre: Prog[]
  bridge: Prog[]
}
interface GenreProgs {
  major: ProgSet
  minor: ProgSet
}

const POP: GenreProgs = {
  major: {
    verse: ['I V vi IV', 'vi IV I V', 'I vi IV V', 'I iii vi IV', 'IV I V vi', 'I V/3 vi IV'],
    chorus: ['IV V vi I', 'I V vi IV', 'vi IV I V', 'IV I V vi', 'I V vi IV'],
    pre: ['ii IV V V', 'IV V IV V', 'vi V IV V', 'ii iii IV V'],
    bridge: ['vi IV I V', 'IV V iii vi', 'ii V I vi', 'bVI bVII I I', 'IV iv I I'],
  },
  minor: {
    verse: ['i bVI bIII bVII', 'i bVII bVI bVII', 'i iv bVI bVII', 'i bIII bVII iv', 'vi IV I V'],
    chorus: ['bVI bIII bVII i', 'i bVI bIII bVII', 'bVI bVII i i', 'bVI bVII bIII i'],
    pre: ['iv bVI bVII bVII', 'bVI bVII bVI V', 'iv v bVI bVII'],
    bridge: ['bVI bVII bIII bVI', 'iv i bVII bVI', 'bIII bVII iv bVI'],
  },
}

const TABLE: Partial<Record<GenreId, Partial<GenreProgs>>> = {
  rock: {
    major: {
      verse: ['I bVII IV I', 'I V vi IV', 'I IV V IV', 'I IV I V'],
      chorus: ['IV I V vi', 'I V vi IV', 'IV V I I', 'I bVII IV I'],
      pre: ['vi V IV V', 'IV V IV V'],
      bridge: ['vi IV I V', 'bVI bVII I I', 'IV vi V V'],
    },
    minor: {
      verse: ['i bVII bVI bVII', 'i bIII bVII IV', 'i bVI bIII bVII', 'i i bVII bVII'],
      chorus: ['bVI bVII i i', 'i bVI bIII bVII', 'bIII bVII i i', 'bVI bIII bVII i'],
      pre: ['bVI bVII bVI bVII', 'iv bVI bVII bVII'],
      bridge: ['iv bVI bVII i', 'bVI bIII bVII IV'],
    },
  },
  metal: {
    minor: {
      verse: ['i i bVI bVII', 'i bII i bVII', 'i bVI bIII bVII', 'i i bII i'],
      chorus: ['i bVI bIII bVII', 'bVI bVII i i', 'i iv bVI V'],
      pre: ['bVI bVII bVI bVII', 'iv iv bVI V'],
      bridge: ['bII i bVII i', 'iv bVI V V'],
    },
  },
  punk: {
    major: {
      verse: ['I V vi IV', 'I IV V IV', 'I bVII IV I', 'I V IV V'],
      chorus: ['IV V I vi', 'I V vi IV', 'IV I V V'],
      pre: ['vi IV V V', 'IV V IV V'],
      bridge: ['vi IV I V', 'IV V vi vi'],
    },
  },
  jazz: {
    major: {
      verse: ['Imaj7 vi7 ii7 V7', 'ii7 V7 Imaj7 IVmaj7', 'Imaj7 VI7 ii7 V7', 'iii7 VI7 ii7 V7'],
      chorus: ['ii7 V7 Imaj7 vi7', 'IVmaj7 iii7 ii7 V7', 'Imaj7 IV7 iii7 VI7'],
      pre: ['ii7 V7 iii7 VI7', 'IVmaj7 #iv° Imaj7 VI7'],
      bridge: ['iii7 VI7 ii7 V7', 'IVmaj7 iv7 iii7 VI7'],
    },
    minor: {
      verse: ['i7 iv7 bVII7 bIIImaj7', 'ii° V7 i7 i7', 'i7 bVImaj7 ii° V7'],
      chorus: ['iv7 bVII7 bIIImaj7 bVImaj7', 'i7 iv7 V7 i7'],
      pre: ['bVImaj7 V7 i7 i7'],
      bridge: ['iv7 bVII7 bIIImaj7 V7'],
    },
  },
  lofi: {
    major: {
      verse: ['IVmaj7 iii7 ii7 Imaj7', 'ii9 V9 Imaj9 vi9', 'Imaj7 vi7 ii7 V7', 'IVmaj7 V7 iii7 vi7'],
      chorus: ['IVmaj7 iii7 vi7 V7', 'ii9 V9 Imaj9 Imaj9', 'Imaj7 iii7 IVmaj7 iv7'],
      pre: ['ii7 iii7 IVmaj7 V7'],
      bridge: ['bVImaj7 bVII7 Imaj7 Imaj7', 'iii7 VI7 ii7 V7'],
    },
    minor: {
      verse: ['i7 iv7 bVIImaj7 bIIImaj7', 'i9 bVImaj7 iv7 V7', 'ii° V7 i7 iv7', 'i7 bVII7 bVImaj7 V7'],
      chorus: ['bVImaj7 bVII7 i7 i7', 'iv9 bVII9 bIIImaj7 bVImaj7'],
      pre: ['iv7 bVImaj7 bVII7 bVII7'],
      bridge: ['bVImaj7 V7 i7 iv7'],
    },
  },
  rnb: {
    major: {
      verse: ['Imaj7 iii7 vi7 IVmaj7', 'IVmaj7 iii7 ii7 Imaj7', 'ii9 V9 Imaj9 vi9', 'Imaj9 IVmaj9 iii7 vi7'],
      chorus: ['IVmaj7 V7 iii7 vi7', 'ii7 iii7 IVmaj7 V7', 'IVmaj9 iii7 vi9 V7'],
      pre: ['ii7 iii7 IVmaj7 V7sus4'],
      bridge: ['bVImaj7 bVII7 Imaj7 Imaj7', 'iii7 VI7 ii7 V7'],
    },
    minor: {
      verse: ['i9 iv7 bVIImaj7 bVImaj7', 'i7 bIIImaj7 iv7 bVII7', 'i9 iv9 i9 V7'],
      chorus: ['bVImaj7 bVII7 i9 i9', 'iv7 v7 bVImaj7 bVII7'],
      pre: ['iv7 bVImaj7 bVII7 bVII7'],
      bridge: ['bVImaj7 V7 i7 iv7'],
    },
  },
  gospel: {
    major: {
      verse: ['I iii7 IV V', 'I I7 IV iv', 'I vi7 ii7 V7', 'IV V iii vi'],
      chorus: ['IV V iii vi', 'ii7 V7 Imaj7 vi7', 'IV I/3 ii7 V7', 'I IV/1 I V'],
      pre: ['ii7 iii7 IV V', 'IV #iv° I/5 V'],
      bridge: ['IV V vi V/3', 'bVII IV I I', 'ii7 V7 iii7 VI7'],
    },
  },
  country: {
    major: {
      verse: ['I IV I V', 'I V IV I', 'I IV V IV', 'I vi IV V'],
      chorus: ['IV I V I', 'I V vi IV', 'IV V I I', 'IV I V vi'],
      pre: ['vi IV V V', 'ii IV V V'],
      bridge: ['IV V vi V', 'vi IV I V'],
    },
  },
  folk: {
    major: {
      verse: ['I V vi IV', 'I IV vi V', 'I iii IV I', 'vi IV I V', 'I IV I V'],
      chorus: ['IV I V vi', 'I V IV I', 'IV V I vi'],
      pre: ['ii IV V V', 'vi IV V V'],
      bridge: ['vi V IV I', 'IV V vi vi'],
    },
  },
  reggae: {
    major: {
      verse: ['I IV I V', 'I V IV I', 'ii V I I', 'I vi IV V', 'I IV I IV'],
      chorus: ['IV V I vi', 'I IV V IV', 'IV I V I'],
      pre: ['ii V ii V'],
      bridge: ['vi V IV V', 'ii iii IV V'],
    },
    minor: {
      verse: ['i iv i bVII', 'i bVII bVI bVII', 'i iv i iv'],
      chorus: ['bVI bVII i i', 'iv bVII i i'],
      pre: ['iv v iv v'],
      bridge: ['bVI bVII iv V'],
    },
  },
  latin: {
    minor: {
      verse: ['i bVI bIII bVII', 'i bVII bVI V', 'i iv bVII bIII', 'i bVI bVII i'],
      chorus: ['i bVI bIII bVII', 'bVI bVII i i', 'iv bVII bIII bVI'],
      pre: ['bVI bVII bVI V'],
      bridge: ['bVI bIII bVII V'],
    },
  },
  edm: {
    minor: {
      verse: ['i bVI bIII bVII', 'bVI bVII i i', 'i bIII bVII bVI', 'i bVI iv bVII'],
      chorus: ['bVI bVII i i', 'i bVI bIII bVII', 'bVI bIII bVII i'],
      pre: ['bVI bVII bVI bVII', 'iv bVI bVII bVII'],
      bridge: ['bVI bIII bVII iv'],
    },
  },
  synthwave: {
    minor: {
      verse: ['i bVI bIII bVII', 'i bVII bVI bVII', 'i bVI bVII bVII', 'i iv bVI bVII'],
      chorus: ['bVI bVII i i', 'bVI bIII bVII i', 'i bVI bIII bVII'],
      pre: ['iv bVI bVII bVII', 'bVI bVII bVI bVII'],
      bridge: ['bIII bVII iv bVI', 'bVI bVII bVI i'],
    },
  },
  kpop: {
    major: {
      verse: ['IVmaj7 V7 iii7 vi7', 'vi IV I V', 'I V vi iii'],
      chorus: ['IVmaj7 V7 iii7 vi7', 'IV V iii vi', 'vi IV I V'],
      pre: ['ii7 iii7 IVmaj7 V7', 'IV V IV V'],
      bridge: ['bVImaj7 bVII7 I I', 'ii7 V7 iii7 vi7'],
    },
    minor: {
      verse: ['i bVI bIII bVII', 'bVImaj7 bVII7 v7 i'],
      chorus: ['bVImaj7 bVII7 v7 i', 'bVI bVII i i'],
      pre: ['iv7 v7 bVImaj7 bVII7'],
      bridge: ['bIIImaj7 bVII7 iv7 V7'],
    },
  },
  ballad: {
    major: {
      verse: ['I V/3 vi IV', 'I iii IV V', 'I IV vi V', 'IV I/3 ii V', 'I vi IV V'],
      chorus: ['IV V vi I', 'IV I/3 V vi', 'vi IV I V', 'I V/3 vi IV'],
      pre: ['ii iii IV V', 'IV V/3 vi V'],
      bridge: ['vi V/3 IV I/3', 'bVI bVII I I', 'ii V iii vi'],
    },
    minor: {
      verse: ['i bVI bIII bVII', 'i v bVI bIII', 'i iv bVII bIII'],
      chorus: ['bVI bVII i i', 'bVI bIII bVII i', 'iv bVI bVII i'],
      pre: ['iv bVI V V'],
      bridge: ['bVI bVII bIII bVI', 'iv i V V'],
    },
  },
  cinematic: {
    major: {
      verse: ['I V vi IV', 'I bVI bVII I', 'vi IV I V'],
      chorus: ['I bVI bVII I', 'IV I V vi', 'vi IV I V'],
      pre: ['ii IV V V'],
      bridge: ['bVI bVII I I', 'IV iv I I'],
    },
    minor: {
      verse: ['i bVI bIII bVII', 'i iv bVI V', 'i bVI iv V', 'i i bVI bVI'],
      chorus: ['bVI bIII bVII i', 'i bVI bIII bVII', 'bVI bVII i i', 'i bVII bVI V'],
      pre: ['iv bVI V V', 'bVI bVII bVI V'],
      bridge: ['bVI bIII iv V', 'iv i bVI V'],
    },
  },
  hiphop: {
    minor: {
      verse: ['i7 iv7 i7 bVI', 'i bVI i bVI', 'i7 bVImaj7 iv7 V7', 'i iv bVI V'],
      chorus: ['bVI bVII i i', 'i7 iv7 bVImaj7 V7', 'i bVI iv V'],
      pre: ['iv7 bVImaj7 V7 V7'],
      bridge: ['bVImaj7 bVII7 i7 i7'],
    },
  },
  trap: {
    minor: {
      verse: ['i bVI i bVII', 'i iv bVI V', 'i bII i bVI', 'i i bVI bVI', 'i bVI bIII bVII'],
      chorus: ['i bVI bIII bVII', 'bVI bVII i i', 'i iv bVI V'],
      pre: ['bVI bVI bVII bVII'],
      bridge: ['bVI V i i'],
    },
  },
}

function progSet(genre: GenreId, mode: 'major' | 'minor'): ProgSet {
  const g = TABLE[genre]
  const s = g?.[mode]
  if (s) return s
  // borrow from the other mode of the same genre if it only defines one, else pop
  if (g && mode === 'major' && g.minor && !g.major) return POP.major
  return POP[mode]
}

export function motifProgKey(m: MotifKey): keyof ProgSet {
  switch (m) {
    case 'verse':
      return 'verse'
    case 'pre':
      return 'pre'
    case 'bridge':
    case 'break':
      return 'bridge'
    default:
      return 'chorus'
  }
}

const MAJOR_SUBS: Record<string, string[]> = {
  I: ['Imaj7', 'Iadd9', 'vi', 'bVI'],
  IV: ['iv', 'IVmaj7', 'ii', 'bVII'],
  V: ['bVII', 'V7', 'Vsus4', 'iii'],
  vi: ['bVI', 'vi7', 'IV', 'III'],
  ii: ['II7', 'ii7', 'IV'],
  iii: ['III7', 'iii7', 'V/3'],
}
const MINOR_SUBS: Record<string, string[]> = {
  i: ['i7', 'iadd9', 'bVI', 'I'],
  iv: ['IV', 'iv7', 'ii°', 'bII'],
  bVI: ['bVImaj7', 'bII', 'iv', 'bVI+'],
  bVII: ['V', 'bVII7', 'bVIIsus4', 'v'],
  bIII: ['bIIImaj7', 'v', 'bIII+'],
  V: ['V7', 'bVII', 'bII'],
}

const COLOR: Partial<Record<GenreId, number>> = { pop: 0.15, kpop: 0.3, edm: 0.1, ballad: 0.2, cinematic: 0.1, folk: 0.1, country: 0.05, synthwave: 0.1, latin: 0.1, rnb: 0.5 }

/**
 * Pick the progressions (as roman numerals) for every motif in the song.
 * weirdness -> substitutions / borrowed chords, styleInfluence -> how strictly to use the genre table.
 */
export function chooseProgressions(genre: GenreId, mode: 'major' | 'minor', r: Rng, weirdness: number, styleInfluence: number): Record<'verse' | 'chorus' | 'pre' | 'bridge', string[]> {
  const set = progSet(genre, mode)
  const foreign = progSet(r.pick(['pop', 'rock', 'jazz', 'lofi', 'cinematic', 'rnb', 'gospel'] as GenreId[]), mode)
  const out = {} as Record<'verse' | 'chorus' | 'pre' | 'bridge', string[]>
  const subs = mode === 'major' ? MAJOR_SUBS : MINOR_SUBS
  const keys: Array<'verse' | 'chorus' | 'pre' | 'bridge'> = ['verse', 'chorus', 'pre', 'bridge']
  for (const k of keys) {
    const pool = r.chance((1 - styleInfluence) * 0.4 + weirdness * 0.25) ? foreign[k] : set[k]
    let prog = r.pick(pool).split(' ')
    // avoid identical verse and chorus
    if (k === 'chorus' && out.verse && prog.join(' ') === out.verse.join(' ') && pool.length > 1) {
      prog = pool.filter((p) => p !== out.verse.join(' '))[0].split(' ')
    }
    prog = prog.map((c, i) => {
      const base = c.replace(/(maj7|maj9|7|9|add9|sus4|sus2|\/3|\/5)$/g, '')
      if (weirdness > 0.05 && subs[base] && r.chance(weirdness * 0.45) && !(i === 0 && k === 'chorus')) return r.pick(subs[base])
      const col = COLOR[genre] ?? 0
      if (col > 0 && !/\d|°|\+/.test(c) && r.chance(col)) return c + (c === c.toUpperCase() ? r.pick(['add9', 'maj7', 'sus2']) : '7')
      return c
    })
    out[k] = prog
  }
  return out
}

/** Pick a scale/mode for melodies (weirdness can change it). */
export function chooseScale(mode: 'major' | 'minor', genre: GenreId, r: Rng, weirdness: number): string {
  if (r.chance(weirdness * 0.5)) {
    return mode === 'major' ? r.pick(['mixolydian', 'lydian']) : r.pick(['dorian', 'phrygian', 'harmonicMinor'])
  }
  if (mode === 'minor' && (genre === 'lofi' || genre === 'rnb' || genre === 'jazz' || genre === 'reggae')) return r.chance(0.5) ? 'dorian' : 'minor'
  if (mode === 'minor' && genre === 'metal' && r.chance(0.3)) return 'phrygian'
  return mode
}
