import { audioCtx } from './audio'

// Sample-accurate multitrack playback on Web Audio, used by Karaoke and Studio.

export interface TrackState {
  id: string
  buffer: AudioBuffer | null
  /** song time (s) at which the buffer's first sample plays */
  offset: number
  volume: number
  pan: number
  muted: boolean
  solo: boolean
}

interface LiveTrack extends TrackState {
  gain: GainNode
  panner: StereoPannerNode
  source: AudioBufferSourceNode | null
}

export class Transport {
  ctx: AudioContext
  master: GainNode
  analyser: AnalyserNode
  tracks = new Map<string, LiveTrack>()
  private playing = false
  private ctxStart = 0 // ctx time when songStart was playing
  private songStart = 0
  private pausedAt = 0
  duration = 0
  onEnded?: () => void
  private endTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.ctx = audioCtx()
    this.master = this.ctx.createGain()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.master.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)
  }

  setTrack(t: Partial<TrackState> & { id: string }) {
    let lt = this.tracks.get(t.id)
    if (!lt) {
      const gain = this.ctx.createGain()
      const panner = this.ctx.createStereoPanner()
      gain.connect(panner)
      panner.connect(this.master)
      lt = { id: t.id, buffer: null, offset: 0, volume: 1, pan: 0, muted: false, solo: false, gain, panner, source: null }
      this.tracks.set(t.id, lt)
    }
    const bufferChanged = t.buffer !== undefined && t.buffer !== lt.buffer
    const offsetChanged = t.offset !== undefined && t.offset !== lt.offset
    Object.assign(lt, t)
    this.recomputeDuration()
    this.applyGains()
    if (this.playing && (bufferChanged || offsetChanged)) {
      // restart just this track in place
      this.stopTrack(lt)
      this.startTrack(lt, this.currentTime, this.ctx.currentTime + 0.02)
    }
  }

  removeTrack(id: string) {
    const lt = this.tracks.get(id)
    if (!lt) return
    this.stopTrack(lt)
    lt.gain.disconnect()
    lt.panner.disconnect()
    this.tracks.delete(id)
    this.recomputeDuration()
  }

  private recomputeDuration() {
    let d = 0
    for (const t of this.tracks.values()) if (t.buffer) d = Math.max(d, t.offset + t.buffer.duration)
    this.duration = d
  }

  applyGains() {
    const anySolo = [...this.tracks.values()].some((t) => t.solo)
    for (const t of this.tracks.values()) {
      const audible = !t.muted && (!anySolo || t.solo)
      t.gain.gain.setTargetAtTime(audible ? t.volume : 0, this.ctx.currentTime, 0.01)
      t.panner.pan.setTargetAtTime(t.pan, this.ctx.currentTime, 0.01)
    }
  }

  get isPlaying() {
    return this.playing
  }

  get currentTime(): number {
    if (!this.playing) return this.pausedAt
    return this.songStart + (this.ctx.currentTime - this.ctxStart)
  }

  /** ctx time at which song time `t` is (or was) scheduled to play */
  ctxTimeForSong(t: number) {
    return this.ctxStart + (t - this.songStart)
  }

  get playbackInfo() {
    return { ctxStart: this.ctxStart, songStart: this.songStart }
  }

  private startTrack(t: LiveTrack, songTime: number, when: number) {
    if (!t.buffer) return
    const src = this.ctx.createBufferSource()
    src.buffer = t.buffer
    src.connect(t.gain)
    const into = songTime - t.offset
    if (into >= t.buffer.duration) return
    if (into >= 0) src.start(when, into)
    else src.start(when - into)
    t.source = src
  }

  private stopTrack(t: LiveTrack) {
    if (t.source) {
      try {
        t.source.stop()
      } catch {
        /* already stopped */
      }
      t.source.disconnect()
      t.source = null
    }
  }

  async play(from?: number, leadIn = 0.08) {
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    if (this.playing) this.stopAll()
    const start = from ?? this.pausedAt
    const when = this.ctx.currentTime + leadIn
    this.songStart = start
    this.ctxStart = when
    for (const t of this.tracks.values()) this.startTrack(t, start, when)
    this.playing = true
    this.scheduleEnd()
  }

  private scheduleEnd() {
    if (this.endTimer) clearTimeout(this.endTimer)
    const remain = this.duration - this.currentTime
    this.endTimer = setTimeout(() => {
      if (!this.playing) return
      if (this.currentTime >= this.duration - 0.05) {
        this.pause()
        this.pausedAt = 0
        this.onEnded?.()
      } else this.scheduleEnd()
    }, Math.max(50, remain * 1000 + 50))
  }

  private stopAll() {
    for (const t of this.tracks.values()) this.stopTrack(t)
  }

  pause() {
    if (!this.playing) return
    this.pausedAt = Math.min(this.currentTime, this.duration)
    this.stopAll()
    this.playing = false
    if (this.endTimer) clearTimeout(this.endTimer)
  }

  seek(t: number) {
    const target = Math.max(0, Math.min(t, this.duration))
    if (this.playing) void this.play(target, 0.03)
    else this.pausedAt = target
  }

  dispose() {
    this.pause()
    for (const id of [...this.tracks.keys()]) this.removeTrack(id)
    this.master.disconnect()
    this.analyser.disconnect()
  }
}
