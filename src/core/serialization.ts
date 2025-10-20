import type { ProjectSnapshot, Track, Clip } from '../types'
import { useProjectStore } from '../store/project'

export function serializeProject(): ProjectSnapshot {
  const pj = useProjectStore()
  return { name: (pj as any).name, fps: pj.fps, durationFrames: pj.durationFrames, tracks: JSON.parse(JSON.stringify(pj.tracks)) }
}

export function saveLocal(name?: string) {
  const pj = useProjectStore() as any
  const finalName = name || pj.name || '未命名项目'
  pj.name = finalName
  const json = JSON.stringify(serializeProject())
  localStorage.setItem(`ivideo_project_${finalName}`, json)
}

export function loadLocal(name?: string): ProjectSnapshot | null {
  const key = name ? `ivideo_project_${name}` : ''
  let json: string | null = null
  if (key) json = localStorage.getItem(key)
  else {
    // 如果未提供名称，取最近一个（按 localStorage 键排序）
    const keys = Object.keys(localStorage).filter(k=>k.startsWith('ivideo_project_'))
    if (keys.length) json = localStorage.getItem(keys[keys.length-1])
  }
  if (!json) return null
  try { return JSON.parse(json) as ProjectSnapshot } catch { return null }
}

export async function exportVideo() {
  // 使用 MediaRecorder 对 Canvas 进行录制导出（webm），简版实现
  const canvas = document.getElementById('previewCanvas') as HTMLCanvasElement | null
  if (!canvas) return
  const stream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : null
  if (!stream) return
  const chunks: BlobPart[] = []
  const rec = new MediaRecorder(stream as MediaStream, { mimeType: 'video/webm;codecs=vp9' })
  rec.ondataavailable = e=>{ if(e.data && e.data.size>0) chunks.push(e.data) }
  rec.onstop = ()=>{
    const blob = new Blob(chunks, { type: 'video/webm' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'ivideo_export.webm'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  rec.start()
  // 简化：录制固定时长或直到用户再次点击导出结束；这里录制 5 秒作为示例
  setTimeout(()=> rec.stop(), 5000)
}

export type ExportOptions = {
  width?: number
  height?: number
  fps?: number
}

export async function exportVideoWithOptions(opts: ExportOptions){
  const canvas = document.getElementById('previewCanvas') as HTMLCanvasElement | null
  if (!canvas) return
  const orig = { w: canvas.width, h: canvas.height }
  const fps = Math.max(10, Math.min(60, opts.fps || 30))
  if (opts.width && opts.height){ canvas.width = Math.floor(opts.width); canvas.height = Math.floor(opts.height) }
  const canvasStream: MediaStream = (canvas as any).captureStream ? (canvas as any).captureStream(fps) : null as any
  if (!canvasStream) { if (opts.width && opts.height){ canvas.width=orig.w; canvas.height=orig.h } return }
  const mixed = new MediaStream()
  // 加入视频画面轨
  canvasStream.getVideoTracks().forEach(t=> mixed.addTrack(t))
  // 使用 WebAudio 合并音轨（文本/贴图无声，视频/音频轨需合流）
  try {
    const ac = new (window.AudioContext || (window as any).webkitAudioContext)()
    const dest = ac.createMediaStreamDestination()
    // 收集所有 <video>/<audio> 元素音轨进入 WebAudio（如果存在）
    const mediaEls = Array.from(document.querySelectorAll('video, audio')) as (HTMLVideoElement|HTMLAudioElement)[]
    for (const el of mediaEls){
      try {
        const srcNode = ac.createMediaElementSource(el as any)
        srcNode.connect(dest)
      } catch {}
    }
    // 合成的音轨加入 mixed
    dest.stream.getAudioTracks().forEach(t=> mixed.addTrack(t))
  } catch {}
  function pickMime(){
    const cands = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ]
    for (const m of cands){ try { if ((window as any).MediaRecorder && (MediaRecorder as any).isTypeSupported && MediaRecorder.isTypeSupported(m)) return m } catch {} }
    return ''
  }
  let rec: MediaRecorder
  const mime = pickMime()
  try { rec = mime ? new MediaRecorder(mixed, { mimeType: mime }) : new MediaRecorder(mixed) } catch { rec = new MediaRecorder(mixed) }
  const chunks: BlobPart[] = []
  rec.ondataavailable = e=>{ if(e.data && e.data.size>0) chunks.push(e.data) }
  rec.onstop = ()=>{
    const blob = new Blob(chunks, { type: 'video/webm' })
    // 若录制失败或没有任何数据
    if (!blob || blob.size === 0){
      try { window.dispatchEvent(new Event('ivideo-export-end')) } catch {}
      alert('导出失败：没有录制到画面或浏览器不支持该编码。请尝试更换分辨率或浏览器。')
      if (opts.width && opts.height){ canvas.width=orig.w; canvas.height=orig.h }
      try { window.dispatchEvent(new CustomEvent('ivideo-export-complete', { detail: { ok: false } })) } catch {}
      return
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'ivideo_export.webm'
    a.click(); URL.revokeObjectURL(a.href)
    // 恢复画布尺寸
    if (opts.width && opts.height){ canvas.width=orig.w; canvas.height=orig.h }
    try { window.dispatchEvent(new Event('ivideo-export-end')) } catch {}
    try { window.dispatchEvent(new CustomEvent('ivideo-export-complete', { detail: { ok: true } })) } catch {}
  }
  // 逐帧导出：从 0 到 durationFrames，强制驱动渲染并写入 MediaRecorder
  const pj = useProjectStore()
  const total = Math.max(1, pj.durationFrames)
  let cur = 0
  const onRendered = (e:any)=>{ /* 可用于精确帧同步，当前用时间片 */ }
  window.addEventListener('ivideo-rendered' as any, onRendered)
  // 标记导出开始，冻结预览尺寸
  window.dispatchEvent(new Event('ivideo-export-start'))
  try { rec.start() } catch { try { rec.start(Math.max(10, Math.floor(1000/fps))) } catch {} }
  const step = ()=>{
    if (cur >= total){
      try { window.dispatchEvent(new CustomEvent('ivideo-export-progress', { detail: { current: total, total, percent: 100 } })) } catch {}
      try { rec.requestData() } catch {}
      setTimeout(()=>{ try{ rec.stop() } catch {} }, 50)
      window.removeEventListener('ivideo-rendered' as any, onRendered)
      return
    }
    window.dispatchEvent(new CustomEvent('ivideo-set-playhead',{ detail:{ frame: cur } }))
    // 请求一次同步渲染（预览 render 会响应并触发 ivideo-rendered）
    window.dispatchEvent(new Event('ivideo-rebuild'))
    try {
      const percent = Math.min(100, Math.round((cur / total) * 100))
      window.dispatchEvent(new CustomEvent('ivideo-export-progress', { detail: { current: cur, total, percent } }))
    } catch {}
    cur += 1
    setTimeout(step, Math.max(0, Math.floor(1000/fps)))
  }
  step()
}

export async function exportVideoFullProject(opts: { width?:number,height?:number,fps?:number }){
  const pj = useProjectStore()
  const seconds = Math.max(1, Math.floor((pj.durationFrames || 1) / (pj.fps || 30)))
  await exportVideoWithOptions({ width: opts.width, height: opts.height, fps: opts.fps, /*seconds not used directly*/ })
  // 标记导出结束（在 onstop 时也会恢复，双保险）
  setTimeout(()=> window.dispatchEvent(new Event('ivideo-export-end')), 0)
}

