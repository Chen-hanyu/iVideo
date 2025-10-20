import { defineStore } from 'pinia'

export const useUIStore = defineStore('ui', {
  state: () => ({
    pxPerFrame: 6,
    trackHeight: 56,
    playhead: 0,
    snapEnabled: true,
    selectedClipId: null as string | null,
  }),
  actions: {
    setPxPerFrame(n: number) { this.pxPerFrame = n },
    setTrackHeight(n: number) { this.trackHeight = n },
    setPlayhead(fr: number) { this.playhead = fr },
    setSelectedClip(id: string | null) { this.selectedClipId = id },
  }
})
