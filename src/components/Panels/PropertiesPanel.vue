<template>
  <div class="panel-content" @keydown.stop>
    <template v-if="!clip">
      <div class="group">
        <div class="group-title">未选中</div>
        <div class="row"><span style="grid-column:1 / -1; color: var(--muted);">选择一个片段以编辑属性</span></div>
      </div>
    </template>
    <template v-else>
      <div v-for="g in schema.groups" :key="g.title" class="group">
        <div class="group-title">{{ g.title }}</div>
        <div v-for="f in g.fields" :key="f.key" class="row">
          <label>{{ f.label }}</label>
          <component
            :is="inputTag(f)"
            v-bind="inputProps(f)"
            :value="valueProp(f)"
            :checked="checkedProp(f)"
            @input="onFieldInput(f, $event)"
            @change="onFieldInput(f, $event)"
          />
          <span v-if="f.type==='slider'">{{ values[f.key] }}</span>
          <span v-else></span>
        </div>
      </div>
      <div v-if="clip && clip.type==='video'" class="group">
        <div class="group-title">音频</div>
        <div class="row" style="grid-template-columns: 1fr auto;">
          <span style="grid-column:1 / span 1; color: var(--muted);">从当前视频片段分离音频</span>
          <button class="action-btn" @click="onDetachAudio">分离音频</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useProjectStore } from '../../store/project'
import { useUIStore } from '../../store/ui'
import cfg from '../../config/panels'

const pj = useProjectStore()
const ui = useUIStore()

const clip = computed(() => {
  if (!ui.selectedClipId) return null
  for (const t of pj.tracks) {
    const c = t.clips.find(c => c.id === ui.selectedClipId)
    if (c) return c
  }
  return null
})

const schema = computed(() => cfg[(clip.value?.type || 'video') as keyof typeof cfg] || { groups: [] })

const values = reactive<Record<string, any>>({})
watch([clip, schema], () => {
  Object.keys(values).forEach(k => delete values[k])
  const c = clip.value
  if (!c) return
  for (const g of schema.value.groups) {
    for (const f of g.fields) {
      const v = f.key === 'start' ? (c as any).start : f.key === 'end' ? (c as any).end : ((c.data && (c.data as any)[f.key]) ?? f.default ?? '')
      values[f.key] = v
    }
  }
}, { immediate: true })

function inputTag(f: any) {
  if (f.type === 'slider') return 'input'
  if (f.type === 'switch') return 'input'
  if (f.type === 'color') return 'input'
  if (f.type === 'number') return 'input'
  return 'input'
}
function inputProps(f: any) {
  const p: any = {}
  if (f.type === 'slider') { p.type = 'range'; p.min = f.min; p.max = f.max; p.step = f.step }
  else if (f.type === 'switch') { p.type = 'checkbox' }
  else if (f.type === 'color') { p.type = 'color' }
  else if (f.type === 'number') { p.type = 'number'; p.min = f.min; p.max = f.max; p.step = f.step }
  else { p.type = 'text' }
  return p
}

  function valueProp(f:any){
    if (f.type==='switch') return undefined
    return values[f.key]
  }
  function checkedProp(f:any){
    if (f.type==='switch') return !!values[f.key]
    return undefined
  }

  function onFieldInput(f: any, e: Event) {
    const id = ui.selectedClipId
    if (!id) return
    const target = e.target as HTMLInputElement
    const raw = f.type==='switch' ? target.checked : target.value
    const value = normalizeValue(f, raw)
    values[f.key] = value
    if (f.key === 'start' || f.key === 'end') {
      pj.updateClipPartial(id, { [f.key]: Number(value) })
      window.dispatchEvent(new Event('ivideo-rebuild'))
      return
    }
    // 若是视频播放组的 speed，除写入 data 外，伸缩片段长度
    if (f.key === 'speed') {
      for (let ti=0; ti<pj.tracks.length; ti++){
        const track = pj.tracks[ti]
        const ci = track.clips.findIndex(c=>c.id===id)
        if (ci>=0){
          const clip:any = track.clips[ci]
          if (clip.type==='video'){
            const v = Math.max(0.25, Math.min(4, Number(value)))
            const len = clip.end - clip.start
            const newLen = Math.max(1, Math.round(len / v))
            clip.end = clip.start + newLen
            if (!clip.data) clip.data = {}
            clip.data.speed = v
            window.dispatchEvent(new Event('ivideo-rebuild'))
            return
          }
        }
      }
    }
    pj.updateClipDataKey(id, f.key, value)
    window.dispatchEvent(new CustomEvent('ivideo-update-clip', { detail: { id, key: f.key, value } }))
    // 强制一次重建，确保预览与时间轴都立即刷新
    window.dispatchEvent(new Event('ivideo-rebuild'))
  }
function normalizeValue(f: any, v: any) {
  if (f.type === 'switch') return !!v
  if (f.type === 'number' || f.type === 'slider') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return v
}

  function onDetachAudio(){
  const id = ui.selectedClipId
  if (!id) return
  const pj = useProjectStore()
  // 找到视频片段所在轨道与片段
  for (let ti=0; ti<pj.tracks.length; ti++){
    const track = pj.tracks[ti]
    const ci = track.clips.findIndex(c=>c.id===id)
    if (ci>=0){
      const clip = track.clips[ci]
      if (clip.type !== 'video') return
        const audioTrack = ensureAudioTrackBelowVideo(ti)
        const audioClip = { id: 'c_'+Math.random().toString(36).slice(2,9), type: 'audio', start: clip.start, end: clip.end, data: { source: clip.data?.source, label: (clip.label||'音频') } } as any
        audioTrack.clips.push(audioClip)
        window.dispatchEvent(new Event('ivideo-rebuild'))
        break
    }
  }

  function ensureAudioTrackBelowVideo(videoTrackIndex: number){
    const pj = useProjectStore()
    // 优先查找视频轨下方是否已有 audio 轨
    const next = pj.tracks[videoTrackIndex+1]
    if (next && next.type==='audio') return next
    // 否则在 videoTrackIndex+1 处插入新的 audio 轨
    const t = pj.addTrack('audio' as any)!
    // 将新轨移动到 videoTrackIndex+1
    const idx = pj.tracks.findIndex(x=>x.id===t.id)
    if (idx>=0){ pj.tracks.splice(idx,1); pj.tracks.splice(Math.min(videoTrackIndex+1, pj.tracks.length),0,t) }
    return t
  }
}

// 移除下方临时变速逻辑，改到“播放”组的 speed 字段生效（已在预览里读取 clip.data.speed）
</script>

<style scoped>
/* 使用全局样式类，保持视觉统一 */
</style>
