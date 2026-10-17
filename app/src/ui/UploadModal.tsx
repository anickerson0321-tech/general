import { useState } from 'react'
import { Modal, Spinner } from './components'
import { uploadSong, friendlyError } from '../engines/generate'
import { useApp } from '../state/store'
import { navigate } from './router'
import { I } from './icons'

export function UploadButton({ label = 'Upload audio', className = 'btn' }: { label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        <I.upload /> {label}
      </button>
      {open && <UploadModal onClose={() => setOpen(false)} />}
    </>
  )
}

function UploadModal({ onClose }: { onClose: () => void }) {
  const { settings, toast } = useApp()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [busy, setBusy] = useState(false)
  const hasKey = !!(settings.keys.fal || settings.keys.elevenlabs)
  const go = async () => {
    if (!file) return
    setBusy(true)
    try {
      const id = await uploadSong(file, { title, lyricsText: lyrics })
      onClose()
      navigate(`/song/${id}`)
    } catch (e) {
      toast(`Couldn’t import that file: ${friendlyError(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal onClose={onClose}>
      <h3>Upload a song to sing</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        {hasKey
          ? 'Encore will remove the vocals with AI and sync the lyrics word by word.'
          : 'Without an AI key, Encore removes centered vocals with a classic karaoke filter (works on most studio mixes). Add a key in Settings for clean AI vocal removal and synced lyrics.'}
      </p>
      <div className="field">
        <div className="field-label">Audio file (MP3, WAV, M4A)</div>
        <input
          className="input"
          type="file"
          accept="audio/*"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            setFile(f)
            if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''))
          }}
        />
      </div>
      <div className="field">
        <div className="field-label">Title</div>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
      </div>
      <div className="field">
        <div className="field-label">Lyrics (optional{hasKey ? ' — leave blank to transcribe automatically' : ''})</div>
        <textarea className="textarea" rows={5} value={lyrics} onChange={(e) => setLyrics(e.target.value)} />
      </div>
      <div className="tiny dim" style={{ marginBottom: 12 }}>Only upload music you have the rights to use.</div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!file || busy} onClick={() => void go()}>
          {busy ? <Spinner size={16} /> : <I.upload />} Import
        </button>
      </div>
    </Modal>
  )
}
