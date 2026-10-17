import { useState, type ReactNode } from 'react'
import { useApp } from '../state/store'
import { coverDataUrl } from '../lib/cover'
import { SongCard, SongRow } from '../ui/components'
import { I } from '../ui/icons'
import { navigate } from '../ui/router'

const GENRES: { name: string; style: string; seed: number }[] = [
  { name: 'Pop', style: 'catchy modern pop, bright synths, female vocals, 118 bpm', seed: 11 },
  { name: 'Hip Hop', style: 'boom bap hip hop, dusty drums, male rap vocals, 92 bpm', seed: 22 },
  { name: 'Trap', style: 'dark trap, 808 bass, hi-hat rolls, male vocals, 140 bpm', seed: 33 },
  { name: 'R&B', style: 'smooth r&b, silky vocals, warm keys, 76 bpm', seed: 44 },
  { name: 'Country', style: 'modern country, acoustic guitar, storytelling, male vocals', seed: 55 },
  { name: 'Rock', style: 'anthemic rock, driving guitars, big drums, 128 bpm', seed: 66 },
  { name: 'Synthwave', style: '80s synthwave, dreamy, neon, female vocals, 105 bpm', seed: 77 },
  { name: 'Lo-fi', style: 'lofi chill, jazzy chords, vinyl crackle, mellow, 80 bpm', seed: 88 },
  { name: 'EDM', style: 'festival edm, euphoric drop, four on the floor, 126 bpm', seed: 99 },
  { name: 'Folk', style: 'acoustic folk, fingerpicked guitar, warm harmonies', seed: 111 },
  { name: 'Gospel', style: 'uplifting gospel, choir, organ, hand claps', seed: 122 },
  { name: 'Cinematic', style: 'epic cinematic orchestral, soaring strings, choir', seed: 133 },
]

export function HomePage() {
  const { songs, settings } = useApp()
  const [prompt, setPrompt] = useState('')
  const live = songs.filter((s) => !s.trashed)
  const ready = live.filter((s) => s.status === 'ready')
  const singable = ready.filter((s) => !s.instrumental && s.timedLyrics?.length)
  const liked = ready.filter((s) => s.liked)
  const go = () => navigate(`/create?prompt=${encodeURIComponent(prompt)}`)
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return (
    <div className="page">
      <section className="hero">
        <div className="small muted" style={{ fontWeight: 600, marginBottom: 8 }}>
          {greet}, {settings.displayName}
        </div>
        <h1>
          Make a song about <em>anything.</em>
          <br />
          Then sing it <em>yourself.</em>
        </h1>
        <p className="muted" style={{ maxWidth: 560, margin: 0 }}>
          Describe a song and get two full versions. Then sing along karaoke-style, and use one slider to take your own voice from raw to radio-ready.
        </p>
        <form
          className="hero-prompt"
          onSubmit={(e) => {
            e.preventDefault()
            go()
          }}
        >
          <input placeholder="A breakup song that's actually happy, 2000s pop punk" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <button className="btn primary">
            <I.music /> Create
          </button>
        </form>
      </section>

      {live.length > 0 && (
        <>
          <div className="section-h">
            <h2>Your latest</h2>
            <a className="btn sm ghost" href="#/library">
              Library
            </a>
          </div>
          <div className="grid">
            {live.slice(0, 6).map((s) => (
              <SongCard key={s.id} song={s} queue={live.map((x) => x.id)} />
            ))}
          </div>
        </>
      )}

      {singable.length > 0 && (
        <>
          <div className="section-h">
            <h2>Sing along</h2>
            <a className="btn sm ghost" href="#/karaoke">
              Karaoke
            </a>
          </div>
          <div>
            {singable.slice(0, 4).map((s) => (
              <SongRow key={s.id} song={s} queue={singable.map((x) => x.id)} />
            ))}
          </div>
        </>
      )}

      <div className="section-h">
        <h2>Start with a genre</h2>
      </div>
      <div className="tiles">
        {GENRES.map((g) => (
          <button key={g.name} className="tile" onClick={() => navigate(`/create?style=${encodeURIComponent(g.style)}`)}>
            <img src={coverDataUrl(g.seed * 7919, g.style)} alt="" />
            <span>{g.name}</span>
          </button>
        ))}
      </div>

      {liked.length > 0 && (
        <>
          <div className="section-h">
            <h2>Liked</h2>
          </div>
          <div className="grid">
            {liked.slice(0, 12).map((s) => (
              <SongCard key={s.id} song={s} queue={liked.map((x) => x.id)} />
            ))}
          </div>
        </>
      )}

      <div className="section-h">
        <h2>How it works</h2>
      </div>
      <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
        {[
          ['1. Create', 'Describe a song or write your own lyrics and styles. You get two versions every time.', I.music],
          ['2. Sing it', 'Karaoke mode plays the backing track and lights up each word as you sing. Your mic records your take.', I.mic],
          ['3. Polish it', 'Slide from your raw voice to clean, studio and fully pitch-perfect. Then mix it in the Studio and export.', I.sparkle],
        ].map(([t, d, Icon]) => {
          const Ic = Icon as () => ReactNode
          return (
            <div key={t as string} className="card">
              <div className="row" style={{ marginBottom: 6, color: 'var(--accent)' }}>
                <Ic />
                <b style={{ color: 'var(--text)' }}>{t as string}</b>
              </div>
              <div className="small muted">{d as string}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
