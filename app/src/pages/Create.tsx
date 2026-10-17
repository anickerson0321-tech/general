import { useMemo, useState } from 'react'
import { useApp } from '../state/store'
import { createSongs, defaultModel, modelOptions, writeLyricsFor, type ModelOption } from '../engines/generate'
import { suggestStyles, analyzeStyle } from '../engines/local'
import { I } from '../ui/icons'
import { Menu, Slider, SongRow, Spinner, Toggle } from '../ui/components'
import { navigate } from '../ui/router'
import { randomSeed } from '../lib/id'

const STYLE_CHIPS = [
  'pop', 'hip hop', 'trap', 'r&b', 'rock', 'indie', 'edm', 'house', 'synthwave', 'lofi', 'country', 'acoustic folk',
  'jazz', 'piano ballad', 'metal', 'reggaeton', 'kpop', 'gospel', 'cinematic', 'female vocals', 'male vocals',
  'upbeat', 'sad', 'dreamy', 'dark', 'epic', 'chill', '90 bpm', '120 bpm', 'catchy hook',
]
const LYRIC_TAGS = ['[Intro]', '[Verse]', '[Pre-Chorus]', '[Chorus]', '[Bridge]', '[Instrumental]', '[Outro]']

export function CreatePage({ query }: { query: URLSearchParams }) {
  const { songs, toast } = useApp()
  const from = query.get('from')
  const src = from ? songs.find((s) => s.id === from) : undefined
  const isCover = query.get('mode') === 'cover'
  const [mode, setMode] = useState<'simple' | 'advanced'>(src || query.get('style') ? 'advanced' : 'simple')
  const [desc, setDesc] = useState(query.get('prompt') ?? '')
  const [lyrics, setLyrics] = useState(src?.lyricsText ?? '')
  const [style, setStyle] = useState(isCover ? '' : (src?.style ?? query.get('style') ?? ''))
  const [exclude, setExclude] = useState(src?.excludeStyle ?? '')
  const [title, setTitle] = useState(src ? (isCover ? `${src.title} (Cover)` : src.title) : '')
  const [instrumental, setInstrumental] = useState(src?.instrumental ?? false)
  const [weird, setWeird] = useState(src?.params.weirdness ?? 0.5)
  const [influence, setInfluence] = useState(src?.params.styleInfluence ?? 0.5)
  const [gender, setGender] = useState<'male' | 'female' | 'any'>(src?.params.vocalGender ?? 'any')
  const [duration, setDuration] = useState<number>(0)
  const [showMore, setShowMore] = useState(false)
  const [model, setModel] = useState<ModelOption>(() => defaultModel())
  const [modelMenu, setModelMenu] = useState<DOMRect | null>(null)
  const [writing, setWriting] = useState(false)
  const [lyricIdea, setLyricIdea] = useState('')
  const [showLyricIdea, setShowLyricIdea] = useState(false)
  const [busy, setBusy] = useState(false)

  const recent = useMemo(() => songs.filter((s) => !s.trashed).slice(0, 40), [songs])
  const queue = recent.map((s) => s.id)

  const toggleStyleChip = (c: string) => {
    const parts = style.split(',').map((s) => s.trim()).filter(Boolean)
    const i = parts.findIndex((p) => p.toLowerCase() === c)
    if (i >= 0) parts.splice(i, 1)
    else parts.push(c)
    setStyle(parts.join(', '))
  }
  const styleHas = (c: string) => style.toLowerCase().split(',').map((s) => s.trim()).includes(c)

  const enhanceStyle = () => {
    const prof = analyzeStyle(style || desc || suggestStyles(randomSeed()))
    const extra = [...prof.tags, ...prof.namedInstruments.slice(0, 3), `${prof.bpm} bpm`, prof.vocalGender !== 'any' ? `${prof.vocalGender} vocals` : '']
    const parts = style.split(',').map((s) => s.trim()).filter(Boolean)
    for (const e of extra) if (e && !parts.some((p) => p.toLowerCase() === e.toLowerCase())) parts.push(e)
    setStyle(parts.join(', '))
  }

  const writeLyrics = async () => {
    setWriting(true)
    try {
      const r = await writeLyricsFor(lyricIdea || desc || title || style, style, model.engine)
      setLyrics(r.lyrics)
      if (!title && r.title) setTitle(r.title)
      if (!style && r.style) setStyle(r.style)
      setShowLyricIdea(false)
    } finally {
      setWriting(false)
    }
  }

  const insertTag = (t: string) => {
    setLyrics((l) => (l && !l.endsWith('\n') ? l + '\n\n' : l) + t + '\n')
  }

  const create = async () => {
    if (!model.available) {
      toast('Add your API key in Settings to use this model.', 'error')
      navigate('/settings')
      return
    }
    setBusy(true)
    try {
      let f = { title, style, lyrics, instrumental }
      if (mode === 'simple') {
        if (!desc.trim()) {
          toast('Describe the song you want first.', 'error')
          return
        }
        const prof = analyzeStyle(desc)
        const autoStyle = [prof.genreLabel, ...prof.moods.slice(0, 2), prof.vocalGender !== 'any' ? `${prof.vocalGender} vocals` : ''].filter(Boolean).join(', ')
        if (instrumental) f = { title: '', style: desc, lyrics: '', instrumental: true }
        else {
          const r = await writeLyricsFor(desc, '', model.engine)
          f = { title: r.title, style: r.style || `${desc}, ${autoStyle}`.slice(0, 900), lyrics: r.lyrics, instrumental: false }
        }
        if (!f.title) f.title = desc.split(/[,.]/)[0].slice(0, 40)
      } else {
        if (!instrumental && !lyrics.trim()) {
          const r = await writeLyricsFor(title || style, style, model.engine)
          f.lyrics = r.lyrics
          setLyrics(r.lyrics)
          if (!f.title) f.title = r.title
        }
        if (!f.style.trim()) f.style = suggestStyles(randomSeed())
      }
      createSongs({
        title: f.title || 'Untitled',
        style: f.style,
        excludeStyle: exclude,
        lyricsText: f.lyrics,
        instrumental: f.instrumental,
        weirdness: weird,
        styleInfluence: influence,
        vocalGender: gender,
        durationHint: duration || undefined,
        choice: { engine: model.engine, model: model.model },
        kind: isCover ? 'cover' : 'generation',
        parentId: src?.id,
      })
      document.querySelector('.create-list')?.scrollIntoView({ behavior: 'smooth' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="create">
        <div className="create-form">
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="seg">
              <button className={mode === 'simple' ? 'on' : ''} onClick={() => setMode('simple')}>
                Simple
              </button>
              <button className={mode === 'advanced' ? 'on' : ''} onClick={() => setMode('advanced')}>
                Advanced
              </button>
            </div>
            <span className="spacer" />
            <button className="model-btn" onClick={(e) => setModelMenu(e.currentTarget.getBoundingClientRect())}>
              <span className="badge hot">{model.badge || 'AI'}</span>
              {model.label}
              <I.chevronDown />
            </button>
          </div>
          {modelMenu && (
            <Menu anchor={modelMenu} onClose={() => setModelMenu(null)} width={310}>
              <div className="lbl">Model</div>
              {modelOptions().map((o) => (
                <button
                  key={o.engine + o.model}
                  onClick={() => {
                    setModel(o)
                    setModelMenu(null)
                    if (!o.available) toast(`Add a ${o.description.split(' ·')[0]} key in Settings to use ${o.label}.`)
                  }}
                  style={{ alignItems: 'flex-start' }}
                >
                  <span style={{ marginTop: 2 }}>{o.model === model.model && o.engine === model.engine ? <I.check /> : <span style={{ width: 17, display: 'inline-block' }} />}</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>
                      {o.label} {!o.available && <span className="badge">key needed</span>}
                    </span>
                    <br />
                    <span className="tiny muted">{o.description}</span>
                  </span>
                </button>
              ))}
            </Menu>
          )}

          {mode === 'simple' ? (
            <>
              <div className="field">
                <div className="field-label">Song description</div>
                <div className="box">
                  <textarea
                    className="textarea"
                    rows={5}
                    maxLength={500}
                    placeholder="A feel-good summer anthem about driving to the beach with my best friends, female vocals"
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                  />
                  <div className="box-foot">
                    <button className="icon-btn sm" title="Surprise me" onClick={() => setDesc(randomIdea())}>
                      <I.dice />
                    </button>
                    <span className="grow" />
                    <span>{desc.length}/500</span>
                  </div>
                </div>
              </div>
              <div className="row" style={{ marginBottom: 16 }}>
                <span className="small" style={{ fontWeight: 600 }}>
                  Instrumental
                </span>
                <Toggle on={instrumental} onChange={setInstrumental} label="Instrumental" />
              </div>
            </>
          ) : (
            <>
              {!instrumental && (
                <div className="field">
                  <div className="field-label">
                    <span>Lyrics</span>
                    <button className="btn sm ghost" onClick={() => setShowLyricIdea((v) => !v)} disabled={writing}>
                      {writing ? <Spinner size={14} /> : <I.wand />} Write with AI
                    </button>
                  </div>
                  {showLyricIdea && (
                    <div className="row" style={{ marginBottom: 6 }}>
                      <input className="input" placeholder="What should the song be about?" value={lyricIdea} onChange={(e) => setLyricIdea(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void writeLyrics()} />
                      <button className="btn sm primary" onClick={() => void writeLyrics()} disabled={writing}>
                        {writing ? <Spinner size={14} /> : 'Write'}
                      </button>
                    </div>
                  )}
                  <div className="box">
                    <textarea
                      className="textarea"
                      rows={10}
                      maxLength={5000}
                      placeholder={'[Verse]\nWrite your own lyrics, or use Write with AI\n\n[Chorus]\n...'}
                      value={lyrics}
                      onChange={(e) => setLyrics(e.target.value)}
                    />
                    <div className="box-foot" style={{ flexWrap: 'wrap' }}>
                      {LYRIC_TAGS.map((t) => (
                        <button key={t} className="chip" style={{ height: 24, fontSize: 11.5 }} onClick={() => insertTag(t)}>
                          {t}
                        </button>
                      ))}
                      <span className="grow" />
                      <span>{lyrics.length}/5000</span>
                    </div>
                  </div>
                </div>
              )}
              <div className="field">
                <div className="field-label">
                  <span>Styles</span>
                  <span className="row" style={{ gap: 2 }}>
                    <button className="icon-btn sm" title="Random style" onClick={() => setStyle(suggestStyles(randomSeed()))}>
                      <I.dice />
                    </button>
                    <button className="btn sm ghost" onClick={enhanceStyle} title="Expand your tags into a detailed style">
                      <I.sparkle /> Enhance
                    </button>
                  </span>
                </div>
                <div className="box">
                  <textarea className="textarea" rows={3} maxLength={1000} placeholder="dreamy synthwave, female vocals, 100 bpm, nostalgic" value={style} onChange={(e) => setStyle(e.target.value)} style={{ minHeight: 70 }} />
                  <div className="box-foot">
                    <span className="grow" />
                    <span>{style.length}/1000</span>
                  </div>
                </div>
                <div className="chips" style={{ marginTop: 8 }}>
                  {STYLE_CHIPS.map((c) => (
                    <button key={c} className={`chip ${styleHas(c) ? 'on' : ''}`} onClick={() => toggleStyleChip(c)}>
                      {styleHas(c) ? '✓ ' : '+ '}
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="small" style={{ fontWeight: 600 }}>
                  Instrumental
                </span>
                <Toggle on={instrumental} onChange={setInstrumental} label="Instrumental" />
                <span className="spacer" />
                <button className="adv-toggle" onClick={() => setShowMore((v) => !v)}>
                  More options <span style={{ transform: showMore ? 'rotate(180deg)' : undefined, display: 'inline-flex' }}><I.chevronDown /></span>
                </button>
              </div>
              {showMore && (
                <div className="card" style={{ padding: 14, marginBottom: 14 }}>
                  <div className="field">
                    <div className="field-label">Exclude styles</div>
                    <input className="input" placeholder="e.g. autotune, heavy drums, screaming" value={exclude} onChange={(e) => setExclude(e.target.value)} />
                  </div>
                  {!instrumental && (
                    <div className="row" style={{ marginBottom: 12 }}>
                      <span className="small muted" style={{ width: 110 }}>
                        Vocal gender
                      </span>
                      <div className="seg">
                        {(['any', 'female', 'male'] as const).map((g) => (
                          <button key={g} className={gender === g ? 'on' : ''} onClick={() => setGender(g)}>
                            {g === 'any' ? 'Auto' : g[0].toUpperCase() + g.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="slider-row">
                    <span>Weirdness</span>
                    <Slider value={weird} onChange={setWeird} label="Weirdness" />
                    <span>{Math.round(weird * 100)}%</span>
                  </div>
                  <div className="slider-row">
                    <span>Style influence</span>
                    <Slider value={influence} onChange={setInfluence} label="Style influence" />
                    <span>{Math.round(influence * 100)}%</span>
                  </div>
                  <div className="slider-row">
                    <span>Length</span>
                    <Slider value={duration} min={0} max={240} step={10} onChange={setDuration} label="Length" />
                    <span>{duration ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : 'Auto'}</span>
                  </div>
                </div>
              )}
              <div className="field">
                <div className="field-label">Song title</div>
                <input className="input" maxLength={100} placeholder="Leave blank to auto-name" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
            </>
          )}
          <button className="btn primary lg" style={{ width: '100%' }} onClick={() => void create()} disabled={busy}>
            {busy ? <Spinner /> : <I.music />} {busy ? 'Writing…' : 'Create'}
          </button>
          <div className="tiny dim" style={{ textAlign: 'center', marginTop: 8 }}>
            Makes 2 versions · {model.engine === 'local' ? 'runs on your device, free' : `uses your ${model.description.split(' ·')[0]} credits`}
          </div>
        </div>

        <div className="create-list">
          <div className="row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>My Workspace</h2>
            <span className="spacer" />
            <a className="btn sm ghost" href="#/library">
              View all
            </a>
          </div>
          {recent.length === 0 ? (
            <div className="empty">
              <div style={{ fontSize: 34, marginBottom: 6 }}>🎤</div>
              Your songs will show up here. Describe a song and hit <b>Create</b>.
            </div>
          ) : (
            recent.map((s) => <SongRow key={s.id} song={s} queue={queue} />)
          )}
        </div>
      </div>
    </div>
  )
}

const IDEAS = [
  'An upbeat pop anthem about finally quitting a job you hate, female vocals',
  'A slow country ballad about your grandpa’s old pickup truck',
  'Dark trap banger about grinding late nights to make it, male vocals, 140 bpm',
  'Dreamy 80s synthwave love song about a neon city at midnight',
  'Lo-fi chill song about a rainy Sunday morning with coffee',
  'Epic cinematic rock song about a hero coming home',
  'A funny reggae tune about a cat who thinks he is the king',
  'Soulful R&B slow jam about missing someone across the ocean',
  'High-energy EDM festival track about dancing until sunrise',
  'Acoustic folk song about growing up in a small mountain town',
]
function randomIdea() {
  return IDEAS[Math.floor(Math.random() * IDEAS.length)]
}
