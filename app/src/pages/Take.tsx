import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state/store'
import { pauseMainPlayer } from '../state/player'
import type { Song, Take } from '../state/models'
import type { MonoBuffer, StereoBuffer } from '../types'
import type { PitchTrack } from '../dsp'
import { describeLevel, levelParams } from '../dsp'
import { Transport } from '../lib/transport'
import { loadBuffer, loadTakeRaw, analyzeTake, guidePitch, pitchAccuracy } from '../lib/songAudio'
import { monoToAudioBuffer, stereoToAudioBuffer, encodeWav, formatTime, waveformPeaks } from '../lib/audio'
import { polishInWorker, encodeMp3InWorker, analyzePitchInWorker } from '../workers/client'
import { mixdown, bufferToSource } from '../lib/mixdown'
import { putBlob } from '../lib/db'
import { uid, randomSeed } from '../lib/id'
import { Slider, Spinner, Toggle, Waveform, downloadBlob, safeName, Modal } from '../ui/components'
import { I } from '../ui/icons'
import { navigate } from '../ui/router'

const STOPS = [
  [0, 'Raw'],
  [15, 'Clean'],
  [35, 'Warm'],
  [55, 'Studio'],
  [75, 'Radio'],
  [95, 'Perfect'],
] as const

/** Render cache shared across visits: `${rawKey}|${amount}|${robotic}|${offset}` -> processed take */
const renderCache = new Map<string, StereoBuffer>()

export function TakePage({ songId, takeId }: { songId: string; takeId: string }) {
  const song = useApp((s) => s.songs.find((x) => x.id === songId))
  const take = song?.takes.find((t) => t.id === takeId)
  if (!song || !take) return <div className="page">Take not found. <a href="#/library/vocals">My vocals</a></div>
  return <TakeEditor key={take.id} song={song} take={take} />
}

function TakeEditor({ song, take }: { song: Song; take: Take }) {
  const { patchSong, toast, upsertSong } = useApp()
  const transport = useMemo(() => new Transport(), [])
  const [raw, setRaw] = useState<MonoBuffer | null>(null)
  const [analysis, setAnalysis] = useState<PitchTrack | null>(null)
  const [guide, setGuide] = useState<PitchTrack | null>(null)
  const [amount, setAmount] = useState(take.polish)
  const [committed, setCommitted] = useState(take.polish)
  const [robotic, setRobotic] = useState(take.robotic)
  const [nudge, setNudge] = useState(take.nudgeMs)
  const [voxVol, setVoxVol] = useState(take.volume)
  const [backVol, setBackVol] = useState(0.85)
  const [hearRaw, setHearRaw] = useState(false)
  const [processed, setProcessed] = useState<StereoBuffer | null>(null)
  const [progress, setProgress] = useState<{ f: number; label: string } | null>({ f: 0, label: 'Loading your take' })
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [before, setBefore] = useState<number | null>(null)
  const [after, setAfter] = useState<number | null>(null)
  const [exporting, setExporting] = useState('')
  const [rename, setRename] = useState(false)
  const renderId = useRef(0)
  const offset = take.offsetSec + nudge / 1000

  // load everything
  useEffect(() => {
    pauseMainPlayer()
    let alive = true
    ;(async () => {
      try {
        const [m, inst] = await Promise.all([loadTakeRaw(take), loadBuffer(song.instrumentalKey ?? song.mixKey)])
        if (!alive) return
        setRaw(m)
        if (inst) transport.setTrack({ id: 'inst', buffer: inst, volume: backVol })
        setProgress({ f: 0.1, label: 'Listening to your pitch' })
        const [a, g] = await Promise.all([analyzeTake(take), song.melody?.length ? Promise.resolve(null) : guidePitch(song)])
        if (!alive) return
        setAnalysis(a)
        setGuide(g)
        setBefore(pitchAccuracy(a, take.offsetSec, song.melody, g).score)
        setProgress(null)
      } catch (e) {
        setProgress({ f: 0, label: `Couldn’t load: ${e instanceof Error ? e.message : e}` })
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take.rawKey])

  useEffect(() => () => transport.dispose(), [transport])

  // render processed take whenever committed settings change
  useEffect(() => {
    if (!raw || !analysis) return
    const sig = `${take.rawKey}|${committed}|${robotic}|${offset.toFixed(3)}`
    const hit = renderCache.get(sig)
    if (hit) {
      setProcessed(hit)
      return
    }
    const myId = ++renderId.current
    const timer = setTimeout(async () => {
      setProgress({ f: 0, label: describeLevel(committed).name })
      try {
        const { out } = await polishInWorker(
          raw,
          { amount: committed, robotic, key: song.key, targetMelody: song.melody, guideTrack: guide ?? undefined, takeOffsetSec: offset, analysis },
          {},
          (f, label) => myId === renderId.current && setProgress({ f, label }),
        )
        if (myId !== renderId.current) return
        renderCache.set(sig, out)
        if (renderCache.size > 8) renderCache.delete(renderCache.keys().next().value as string)
        setProcessed(out)
        setProgress(null)
        // measure tuning after processing (background)
        setAfter(null)
        void analyzePitchInWorker({ sampleRate: out.sampleRate, data: out.left }).then((pa) => {
          if (myId === renderId.current) setAfter(pitchAccuracy(pa, offset, song.melody, guide).score)
        })
      } catch (e) {
        if (myId === renderId.current) {
          setProgress(null)
          toast(`Processing failed: ${e instanceof Error ? e.message : e}`, 'error')
        }
      }
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, analysis, guide, committed, robotic, offset])

  // put the right vocal on the transport
  useEffect(() => {
    if (!raw) return
    const buf = hearRaw || !processed ? monoToAudioBuffer(raw) : stereoToAudioBuffer(processed)
    transport.setTrack({ id: 'vox', buffer: buf, offset, volume: voxVol })
  }, [raw, processed, hearRaw, offset, transport, voxVol])
  useEffect(() => transport.setTrack({ id: 'inst', volume: backVol }), [backVol, transport])

  transport.onEnded = () => setPlaying(false)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      setT(transport.currentTime)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [transport])

  const save = (patch: Partial<Take>) => {
    patchSong(song.id, { takes: song.takes.map((x) => (x.id === take.id ? { ...x, ...patch } : x)) })
  }
  useEffect(() => {
    const h = setTimeout(() => save({ polish: committed, robotic, nudgeMs: nudge, volume: voxVol }), 400)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed, robotic, nudge, voxVol])

  const playFrom = async (from?: number) => {
    const start = from ?? (transport.currentTime > 0 ? transport.currentTime : Math.max(0, offset - 1))
    await transport.play(start)
    setPlaying(true)
  }

  const renderMix = async (): Promise<StereoBuffer | null> => {
    const inst = await loadBuffer(song.instrumentalKey ?? song.mixKey)
    if (!inst || !processed) return null
    return mixdown(
      [bufferToSource(inst, 0, backVol), { left: processed.left, right: processed.right, sampleRate: processed.sampleRate, offsetSec: offset, gain: voxVol }],
      inst.sampleRate,
      inst.duration,
    )
  }

  const exportMix = async () => {
    setExporting('Mixing your version')
    try {
      const mix = await renderMix()
      if (!mix) return
      const mp3 = await encodeMp3InWorker(mix, 192)
      downloadBlob(new Blob([mp3 as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' }), `${safeName(song.title)}_my_version.mp3`)
    } finally {
      setExporting('')
    }
  }

  const exportVocal = () => {
    if (!processed) return
    downloadBlob(encodeWav(processed), `${safeName(song.title)}_${safeName(take.name)}_vocal.wav`)
  }

  const saveToLibrary = async () => {
    setExporting('Saving to your library')
    try {
      const mix = await renderMix()
      if (!mix || !processed) return
      const mp3 = await encodeMp3InWorker(mix, 192)
      const vmp3 = await encodeMp3InWorker(processed, 160)
      const mixKey = uid('a')
      const vocalsKey = uid('a')
      await putBlob(mixKey, new Blob([mp3 as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' }))
      await putBlob(vocalsKey, new Blob([vmp3 as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' }))
      const id = uid('s')
      upsertSong({
        ...song,
        id,
        createdAt: Date.now(),
        title: `${song.title} (My Version)`,
        kind: 'my version',
        parentId: song.id,
        mixKey,
        vocalsKey,
        guidePitchKey: undefined,
        takes: [],
        plays: 0,
        liked: false,
        coverSeed: randomSeed(),
        batchId: uid('b'),
        modelLabel: describeLevel(committed).short,
      })
      toast('Saved to your library as “My Version”.', 'success')
      navigate(`/song/${id}`)
    } finally {
      setExporting('')
    }
  }

  const level = describeLevel(amount)
  const params = levelParams(amount) as unknown as Record<string, unknown>
  const peaks = useMemo(() => (processed && !hearRaw ? waveformPeaks([processed.left, processed.right], 400) : raw ? waveformPeaks([raw.data], 400) : null), [processed, raw, hearRaw])
  const takeProgress = raw ? Math.max(0, Math.min(1, (t - offset) / (raw.data.length / raw.sampleRate))) : 0

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => navigate(`/song/${song.id}`)} aria-label="Back">
          <I.chevronLeft />
        </button>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <h1 className="page-title" style={{ margin: 0 }}>
              {take.name}
            </h1>
            <button className="icon-btn sm" onClick={() => setRename(true)} aria-label="Rename">
              <I.edit />
            </button>
          </div>
          <div className="small muted">
            on “{song.title}” · {formatTime(take.durationSec)}
          </div>
        </div>
        <span className="spacer" />
        <button className="btn sm" onClick={() => navigate(`/karaoke/${song.id}`)}>
          <I.mic /> New take
        </button>
      </div>

      <div className="polish-card">
        <div className="row" style={{ alignItems: 'flex-end', marginBottom: 6 }}>
          <div>
            <div className="small muted" style={{ fontWeight: 600 }}>
              Vocal polish
            </div>
            <div className="polish-level">{robotic && amount >= 40 ? 'Hard Tune' : level.name}</div>
          </div>
          <span className="spacer" />
          <div className="polish-level" style={{ fontSize: 28 }}>
            {amount}
          </div>
        </div>
        <div className="small muted" style={{ minHeight: 40 }}>
          {level.description}
        </div>
        <Slider className="polish-slider" value={amount} min={0} max={100} step={1} onChange={setAmount} onCommit={setCommitted} label="Vocal polish" />
        <div className="polish-stops">
          {STOPS.map(([v, l]) => (
            <span
              key={l}
              className={Math.abs(amount - v) < 10 ? 'on' : ''}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setAmount(v)
                setCommitted(v)
              }}
            >
              {l}
            </span>
          ))}
        </div>

        <div className="row wrap" style={{ marginTop: 18, gap: 16 }}>
          <div className="row">
            <Toggle on={hearRaw} onChange={setHearRaw} label="Hear raw" />
            <span className="small">A/B: hear raw take</span>
          </div>
          <div className="row">
            <Toggle
              on={robotic}
              onChange={(v) => {
                setRobotic(v)
              }}
              label="Hard tune"
            />
            <span className="small">Hard-tune effect</span>
          </div>
          <span className="spacer" />
          {progress ? (
            <span className="small muted row">
              <Spinner size={14} /> {progress.label}… {progress.f > 0 ? `${Math.round(progress.f * 100)}%` : ''}
            </span>
          ) : (
            <span className="small" style={{ color: 'var(--good)' }}>
              <I.check /> Ready
            </span>
          )}
        </div>

        <div className="stat-grid" style={{ marginTop: 16 }}>
          <div className="stat">
            <div className="k">In tune · before</div>
            <div className="v">{before === null ? '…' : `${Math.round(before * 100)}%`}</div>
            <div className="meter">
              <div style={{ width: `${(before ?? 0) * 100}%`, background: '#7a7a88' }} />
            </div>
          </div>
          <div className="stat">
            <div className="k">In tune · after</div>
            <div className="v">{after === null ? (progress ? '…' : '—') : `${Math.round(after * 100)}%`}</div>
            <div className="meter">
              <div style={{ width: `${(after ?? 0) * 100}%` }} />
            </div>
          </div>
          {Object.entries(params)
            .filter(([, v]) => typeof v === 'number')
            .slice(0, 6)
            .map(([k, v]) => (
              <div className="stat" key={k}>
                <div className="k">{prettyKey(k)}</div>
                <div className="v">{fmtParam(k, v as number)}</div>
              </div>
            ))}
        </div>
        <div className="tiny dim" style={{ marginTop: 8 }}>
          Tuning target: {song.melody?.length ? 'the song’s melody' : guide ? 'the AI singer’s melody' : song.key ? 'the song’s key' : 'nearest note'}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <Waveform peaks={peaks} height={70} progress={takeProgress} />
        <div className="row" style={{ marginTop: 12, gap: 12 }}>
          <button className="play-fab" style={{ width: 48, height: 48 }} onClick={() => (playing ? (transport.pause(), setPlaying(false)) : void playFrom())} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <I.pause /> : <I.play />}
          </button>
          <button className="icon-btn" onClick={() => void playFrom(Math.max(0, offset - 1))} aria-label="From start">
            <I.prev />
          </button>
          <span className="small muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(t)} / {formatTime(transport.duration)}
          </span>
          <span className="spacer" />
        </div>
        <div className="mix-sliders" style={{ marginTop: 14 }}>
          <div>
            <label>
              <span>My voice</span>
              <span>{Math.round(voxVol * 100)}%</span>
            </label>
            <Slider value={voxVol} max={1.6} onChange={setVoxVol} label="Voice volume" />
          </div>
          <div>
            <label>
              <span>Backing track</span>
              <span>{Math.round(backVol * 100)}%</span>
            </label>
            <Slider value={backVol} max={1.2} onChange={setBackVol} label="Backing volume" />
          </div>
          <div>
            <label>
              <span>Sync (if your voice is early/late)</span>
              <span>
                {nudge > 0 ? '+' : ''}
                {nudge} ms
              </span>
            </label>
            <Slider value={nudge} min={-400} max={400} step={5} onChange={setNudge} label="Sync nudge" />
          </div>
        </div>
      </div>

      <div className="row wrap" style={{ marginTop: 16 }}>
        <button className="btn primary" disabled={!processed || !!exporting} onClick={() => void saveToLibrary()}>
          <I.library /> Save “My Version” to library
        </button>
        <button className="btn" disabled={!processed || !!exporting} onClick={() => void exportMix()}>
          <I.download /> Download my mix (MP3)
        </button>
        <button className="btn" disabled={!processed} onClick={exportVocal}>
          <I.download /> Vocal only (WAV)
        </button>
        <button className="btn" onClick={() => navigate(`/studio/${song.id}`)}>
          <I.studio /> Studio
        </button>
        <span className="spacer" />
        <button
          className="btn danger ghost"
          onClick={() => {
            if (!confirm('Delete this take?')) return
            patchSong(song.id, { takes: song.takes.filter((x) => x.id !== take.id) })
            navigate(`/song/${song.id}`)
          }}
        >
          <I.trash /> Delete take
        </button>
      </div>
      {exporting && (
        <div className="small muted row" style={{ marginTop: 10 }}>
          <Spinner size={14} /> {exporting}…
        </div>
      )}
      {rename && (
        <Modal onClose={() => setRename(false)}>
          <h3>Rename take</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const n = String(new FormData(e.currentTarget).get('n') || '').trim()
              if (n) save({ name: n })
              setRename(false)
            }}
          >
            <input className="input" name="n" defaultValue={take.name} autoFocus maxLength={60} />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn primary">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function prettyKey(k: string) {
  return k
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/ Ms$/, ' (ms)')
    .replace(/ Db$/, ' (dB)')
}

function fmtParam(k: string, v: number) {
  const lk = k.toLowerCase()
  if (lk.endsWith('ms')) return `${Math.round(v)} ms`
  if (lk.endsWith('db')) return `${v.toFixed(1)} dB`
  if (lk.endsWith('hz')) return `${Math.round(v)} Hz`
  if (v >= 0 && v <= 1) return `${Math.round(v * 100)}%`
  return v.toFixed(Math.abs(v) < 10 ? 1 : 0)
}
