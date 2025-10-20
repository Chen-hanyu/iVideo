import { defineStore } from 'pinia'
import type { ProjectSnapshot, Track, Clip } from '../types'

function deepClone<T>(o: T): T { return JSON.parse(JSON.stringify(o)) }
function uid(prefix='id'){ return prefix + '_' + Math.random().toString(36).slice(2, 9) }

export const useProjectStore = defineStore('project', {
  state: () => ({
    name: '未命名项目',
    fps: 30,
    durationFrames: 300,
    tracks: [] as Track[],
    history: [] as ProjectSnapshot[],
    future: [] as ProjectSnapshot[],
  }),
  getters: {
    snapshot(state): ProjectSnapshot { return { name: state.name, fps: state.fps, durationFrames: state.durationFrames, tracks: deepClone(state.tracks) } },
  },
  actions: {
    setFrom(s: ProjectSnapshot) {
      this.name = s.name ?? this.name
      this.fps = s.fps ?? this.fps
      this.durationFrames = s.durationFrames ?? this.durationFrames
      this.tracks = deepClone(s.tracks || [])
    },
    setName(n: string){ this.name = n },
    pushHistory() { this.history.push(this.snapshot); if (this.history.length > 100) this.history.shift(); this.future.length = 0 },
    undo() { if (!this.history.length) return; const last = this.history.pop()!; this.future.push(this.snapshot); this.setFrom(last) },
    redo() { if (!this.future.length) return; const next = this.future.pop()!; this.history.push(this.snapshot); this.setFrom(next) },
    addTrack(type: Track['type']) {
      const t: Track = { id: uid('t'), type, clips: [] }
      this.tracks.push(t)
      return t
    },
    addClip(trackId: string, clip: Omit<Clip, 'id'> & Partial<Pick<Clip,'id'>>) {
      const track = this.tracks.find(t => t.id === trackId)
      if (!track) return null
      const c: Clip = { id: clip.id || uid('c'), type: clip.type, start: clip.start, end: clip.end, data: clip.data || {}, label: clip.label, source: clip.source }
      track.clips.push(c)
      return c
    },
    findClipIndexes(id: string) {
      for (let ti = 0; ti < this.tracks.length; ti++) {
        const ci = this.tracks[ti].clips.findIndex(c => c.id === id)
        if (ci >= 0) return { ti, ci }
      }
      return null
    },
    updateClipPartial(id: string, patch: Partial<Clip>) {
      const pos = this.findClipIndexes(id)
      if (!pos) return
      const c = this.tracks[pos.ti].clips[pos.ci]
      Object.assign(c, patch)
    },
    updateClipDataKey(id: string, key: string, value: any) {
      const pos = this.findClipIndexes(id)
      if (!pos) return
      const c = this.tracks[pos.ti].clips[pos.ci]
      if (!c.data) c.data = {}
      ;(c.data as any)[key] = value
    }
  }
})
