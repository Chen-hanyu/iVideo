export type TrackType = 'video' | 'audio' | 'text' | 'sticker'

export interface ClipData {
  [key: string]: any
}

export interface Clip {
  id: string
  type: TrackType
  start: number
  end: number
  data?: ClipData
  label?: string
  source?: string
}

export interface Track {
  id: string
  type: TrackType
  clips: Clip[]
  hidden?: boolean
  locked?: boolean
  solo?: boolean
}

export interface ProjectSnapshot {
  name?: string
  fps: number
  durationFrames: number
  tracks: Track[]
  pxPerFrame?: number
  trackHeight?: string | number
}
