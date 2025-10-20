import { useProjectStore } from '../store/project'
import { useUIStore } from '../store/ui'

type VideoCache = { [src: string]: HTMLVideoElement }
type ImageCache = { [src: string]: HTMLImageElement }

const videos: VideoCache = {}
const images: ImageCache = {}

export function setupPreview() {
  const canvas = document.getElementById('previewCanvas') as HTMLCanvasElement
  const ctx = canvas.getContext('2d')!
  // offscreen canvas for pixel-level beautify processing
  const workCanvas = document.createElement('canvas')
  const workCtx = workCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  const overlay = document.getElementById('overlayLayer') as HTMLDivElement | null
  const btnPrev = document.getElementById('btnPrev') as HTMLButtonElement | null
  const btnPlay = document.getElementById('btnPlay') as HTMLButtonElement | null
  const btnNext = document.getElementById('btnNext') as HTMLButtonElement | null
  const timeLabel = document.getElementById('timeLabel') as HTMLDivElement | null
  const placeholder = canvas?.parentElement?.querySelector('.placeholder') as HTMLElement | null

  const pj = useProjectStore()
  const ui = useUIStore()

  const ensureSize = () => {
    if ((window as any).__IV_EXPORTING__) {
      // 导出中：不要改动画布尺寸，保持导出分辨率
      workCanvas.width = canvas.width
      workCanvas.height = canvas.height
      return
    }
    const rect = (canvas.parentElement as HTMLElement).getBoundingClientRect()
    canvas.width = Math.max(2, Math.floor(rect.width))
    canvas.height = Math.max(2, Math.floor(rect.height))
    workCanvas.width = canvas.width
    workCanvas.height = canvas.height
  }
  ensureSize()
  window.addEventListener('resize', ensureSize)

  let reqId = 0
  let playing = false
  let lastTs = 0
  let activeClip: any = null
  let activeVideo: HTMLVideoElement | null = null
  let editingOverlayId: string | null = null
  async function render() {
    ensureSize()
    const id = ++reqId
    const frame = ui.playhead
    const fps = pj.fps || 30

    // clear bg only when drawing updates
      const { base, overlays } = getActiveLayers(frame)
      // 允许 overlays 独立显示（例如仅贴图/文本），当没有视频 base 时也能预览
      if (!base && overlays.length===0) { if (placeholder) placeholder.style.display = 'grid'; updateTime(); return }
      if (placeholder) placeholder.style.display = 'none'

    const notifyRendered = (f:number)=>{ try { window.dispatchEvent(new CustomEvent('ivideo-rendered',{ detail:{ frame:f } })) } catch {} }

    if (playing) {
      await ensureActive(frame)
      if (activeVideo && activeClip) {
        const speed = num(activeClip?.data?.speed, 1)
        activeVideo.playbackRate = Math.max(0.1, Math.min(8, speed || 1))
        const next = activeClip.start + Math.round(activeVideo.currentTime * fps * (speed || 1))
        const ovs = overlaysForFrame(next)
        drawWithFilters(activeClip, undefined, ovs)
        if (next !== ui.playhead) setPlayhead(next)
        notifyRendered(next)
      }
    } else {
      // paused: seek and draw静态帧
      const src = String(base?.data?.source || base?.source || '')
      if (!src) {
        // 没有视频也要绘制 overlays（贴图/文本）
        drawWithFilters(null as any, undefined, overlaysForFrame(frame))
        updateTime(); notifyRendered(frame)
        return
      }
      const video = await getVideo(src)
      const speed = num(base?.data?.speed, 1)
      const localTime = Math.max(0, (frame - (base as any).start) / (fps * (speed || 1)))
      try { await seekVideo(video, localTime) } catch {}
      drawWithFilters(base as any, video, overlaysForFrame(frame))
      updateTime(); notifyRendered(frame)
    }

    function drawWithFilters(c: any, v?: HTMLVideoElement, ov: any[] = []){
      const videoEl = v || activeVideo
      // clear background
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#10151c'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      // 如果存在视频，则绘制视频底层
      if (videoEl){
        const exposure = num(c?.data?.exposure, 0)
        const contrast = num(c?.data?.contrast, 1)
        const saturation = num(c?.data?.saturation, 1)
        const temperature = num(c?.data?.temperature, 6500)
        const brightness = Math.pow(2, exposure)
        const warm = Math.max(0.5, Math.min(1.5, (temperature - 6500) / 6500 + 1))
        const filterStr = `brightness(${brightness}) contrast(${contrast}) saturate(${saturation}) hue-rotate(${(warm-1)*30}deg)`
        try { (canvas as any).style.filter = 'none' } catch {}
        ctx.save()
        ctx.filter = filterStr
        const opacity = Math.max(0, Math.min(1, num(c?.data?.opacity, 1)))
        const prevAlpha = ctx.globalAlpha
        ctx.globalAlpha = opacity
        drawContain(videoEl, ctx, canvas)
        ctx.globalAlpha = prevAlpha
        ctx.filter = 'none'
        ctx.restore()
      }

      // optional sharpen pass on top via work canvas (if requested and allowed)
      const sharpen = num(c.data?.sharpen, 0)
      if (sharpen > 0){
        try {
          workCtx.clearRect(0, 0, workCanvas.width, workCanvas.height)
          workCtx.drawImage(canvas, 0, 0)
          const img = workCtx.getImageData(0, 0, workCanvas.width, workCanvas.height)
          const adjusted = applyBeautify(img, { exposure: 0, contrast: 1, saturation: 1, temperature: 6500, sharpen })
          workCtx.putImageData(adjusted, 0, 0)
          ctx.drawImage(workCanvas, 0, 0)
        } catch {}
      }
      // overlay tracks（text/sticker 等），按轨道从上到下叠加
      // 根据轨道顺序决定叠放层级：tracks 数组后面的轨道在上层
      const ordered = orderOverlaysByTracks(ov)
      ordered.forEach(overlay => {
        if (overlay.type === 'text') {
          // 如果正在编辑该文本，画布不再绘制，避免与覆盖层文字叠影
          if (editingOverlayId && overlay.id === editingOverlayId) {
            return
          }
          const scale = num(overlay.data?.scale, 1)
          const ox = num(overlay.data?.x, 0)
          const oy = num(overlay.data?.y, 0)
          const rot = num(overlay.data?.rotation, 0)
          const fontSize = Math.max(8, num(overlay.data?.fontSize, 28))
          const opacityOv = Math.max(0, Math.min(1, num(overlay.data?.opacity, 1)))
          ctx.save()
          ctx.translate(canvas.width/2 + ox, canvas.height/2 + oy)
          ctx.rotate(rot * Math.PI / 180)
          ctx.scale(scale, scale)
          const prevAlphaOv = ctx.globalAlpha
          ctx.globalAlpha = opacityOv
          // 字重
          const isBold = !!overlay.data?.bold
          const withOutline = !!overlay.data?.outline
          ctx.fillStyle = String(overlay.data?.color || '#ffffff')
          ctx.font = `${isBold?'bold':'normal'} ${fontSize}px ui-sans-serif, system-ui`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          // 强化描边可见度
          if (withOutline) {
            ctx.save()
            ctx.lineJoin = 'round'
            ctx.miterLimit = 2
            ctx.lineWidth = Math.max(2, Math.floor(fontSize/6))
            ctx.strokeStyle = String(overlay.data?.outlineColor || 'rgba(0,0,0,0.9)')
            drawMultilineStroke(ctx, String(overlay.data?.content || overlay.label || '文字'))
            ctx.restore()
          }
          if (isBold) {
            // 一些系统字体粗细不明显，做一次微偏移叠加增强
            ctx.save()
            const txt = String(overlay.data?.content || overlay.label || '文字')
            drawMultilineOffset(ctx, txt, 0.3, 0)
            drawMultilineOffset(ctx, txt, -0.3, 0)
            drawMultilineOffset(ctx, txt, 0, 0.3)
            drawMultilineOffset(ctx, txt, 0, -0.3)
            ctx.restore()
          }
          drawMultiline(ctx, String(overlay.data?.content || overlay.label || '文字'))
          ctx.globalAlpha = prevAlphaOv
          ctx.restore()
        } else if (overlay.type === 'sticker') {
          const scale = num(overlay.data?.scale, 1)
          const ox = num(overlay.data?.x, 0)
          const oy = num(overlay.data?.y, 0)
          const rot = num(overlay.data?.rotation, 0)
          const op = Math.max(0, Math.min(1, num(overlay.data?.opacity, 1)))
          const src = String(overlay.data?.source || '')
          if (src) {
            const img = getImage(src)
            if (img && img.complete) {
              ctx.save()
              ctx.translate(canvas.width/2 + ox, canvas.height/2 + oy)
              ctx.rotate(rot * Math.PI/180)
              ctx.scale(scale, scale)
              const prevAlphaOv = ctx.globalAlpha
              ctx.globalAlpha = op
              const iw = img.naturalWidth || 200, ih = img.naturalHeight || 200
              const max = Math.min(canvas.width, canvas.height) * 0.4
              const s = Math.min(max/iw, max/ih)
              ctx.drawImage(img, -iw*s/2, -ih*s/2, iw*s, ih*s)
              ctx.globalAlpha = prevAlphaOv
              ctx.restore()
            } else {
              img && img.addEventListener('load', ()=> requestAnimationFrame(render), { once: true })
            }
          }
        }
        // 贴图/图片可在此 drawImage（留待后续扩展）
      })
    }
  }

  function orderOverlaysByTracks(ov: any[]){
    // 以 DOM 中轨道的视觉顺序为准（上→下），越靠上越应该后绘制（在最上层）
    const trackIndex: Record<string, number> = {}
    const domTracks = Array.from(document.querySelectorAll('.timeline .tracks .track')) as HTMLElement[]
    domTracks.forEach((tr, i)=>{ const id=tr.getAttribute('data-track-id')||''; if(id) trackIndex[id]=i })
    const typeRank = (t:string)=> (t==='video'?0 : t==='text'?1 : t==='sticker'?2 : 0)
    return [...ov].sort((a:any,b:any)=>{
      const ta = findTrackIdOfClip(a.id)
      const tb = findTrackIdOfClip(b.id)
      const ia = (ta in trackIndex) ? trackIndex[ta] : 999
      const ib = (tb in trackIndex) ? trackIndex[tb] : 999
      // 使上方(较小的 i)拥有更大 z 值：z = 1000 - i
      const za = (1000 - ia)*10 + typeRank(a.type)
      const zb = (1000 - ib)*10 + typeRank(b.type)
      return za - zb
    })
  }

  function findTrackIdOfClip(id:string){
    for (const t of pj.tracks){ if (t.clips.some(c=>c.id===id)) return t.id }
    return ''
  }

  function updateTime(){
    if (!timeLabel) return
    const fps = pj.fps || 30
    const cur = ui.playhead
    const total = pj.durationFrames
    timeLabel.textContent = `${fmt(cur, fps)} / ${fmt(total, fps)}`
  }

  function fmt(fr: number, fps: number){
    const s = Math.floor(fr / fps)
    const f = Math.floor(fr % fps)
    const m = Math.floor(s / 60)
    const ss = s % 60
    const pad = (n: number, l=2)=> String(n).padStart(l,'0')
    return `${pad(m)}:${pad(ss)}:${pad(f)}`
  }

  // Playback controls
  btnPrev?.addEventListener('click', ()=>{ playing=false; btnPlay && (btnPlay.textContent='▶'); setPlayhead(ui.playhead - 1) })
  btnNext?.addEventListener('click', ()=>{ playing=false; btnPlay && (btnPlay.textContent='▶'); setPlayhead(ui.playhead + 1) })
  btnPlay?.addEventListener('click', async ()=>{
    playing = !playing
    btnPlay && (btnPlay.textContent = playing ? '⏸' : '▶')
    if (playing){ lastTs = 0; await ensureActive(ui.playhead); activeVideo && activeVideo.play(); tick() } else { activeVideo && activeVideo.pause() }
  })

  function tick(){
    if (!playing) return
    const fps = pj.fps || 30
    if (!activeClip || !activeVideo){
      // 无视频基底：按 fps 推进播放头并渲染黑屏+overlays
      const now = performance.now()
      if (!lastTs) lastTs = now
      const dt = now - lastTs
      const step = Math.max(1, Math.floor(dt * fps / 1000))
      if (step > 0){
        lastTs = now
        const next = ui.playhead + step
        if (next >= pj.durationFrames) { playing=false; btnPlay && (btnPlay.textContent='▶'); return }
        setPlayhead(next)
        // 直接渲染当前帧（无视频时 drawWithFilters 会绘制背景+overlays）
        const ovs = overlaysForFrame(next)
        drawWithFilters(null as any, undefined, ovs)
      }
      requestAnimationFrame(tick)
      return
    }
    // 有视频基底：按 video currentTime 推进
    const next = activeClip.start + Math.round(activeVideo.currentTime * fps)
    if (next >= pj.durationFrames) { playing=false; btnPlay && (btnPlay.textContent='▶'); return }
    if (next !== ui.playhead) setPlayhead(next)
    render()
    requestAnimationFrame(tick)
  }

  function setPlayhead(fr: number){
    window.dispatchEvent(new CustomEvent('ivideo-set-playhead', { detail: { frame: fr } }))
  }

  async function ensureActive(frame: number){
    const fps = pj.fps || 30
    const clip = findActiveClip(frame)
    if (!clip) { if (activeVideo) try{ activeVideo.pause() }catch{}; activeVideo=null; activeClip=null; return }
    if (!activeClip || activeClip.id !== clip.id){
      const src = String(clip.data?.source || clip.source || '')
      if (!src) { activeClip=null; activeVideo=null; return }
      activeClip = clip
      try { activeVideo = await getVideo(src) } catch { activeVideo=null }
      activeVideo.muted = true
      activeVideo.playbackRate = 1
      const localTime = Math.max(0, (frame - clip.start) / fps)
      try { await seekVideo(activeVideo, localTime) } catch {}
      // 如果是 blob: 链接，可能在刷新后失效；尝试通过 <video> 重新加载失败时提示重连
      if (!activeVideo || Number.isNaN(activeVideo.duration) || (activeVideo.readyState||0) < 1){
        try { window.dispatchEvent(new CustomEvent('ivideo-media-invalid', { detail: { id: clip.id, src } })) } catch {}
      }
    }
  }

  function findActiveClip(frame: number, type: 'video'|'text'|'audio'|'sticker'|undefined = 'video') {
    for (const t of pj.tracks) {
      if (type && t.type !== type) continue
      const c = t.clips.find(c => frame >= c.start && frame < c.end)
      if (c) return c
    }
    return null
  }

  function getActiveLayers(frame: number){
    let base: any = null
    const overlays: any[] = []
    pj.tracks.forEach(t => {
      const c = t.clips.find(c => frame >= c.start && frame < c.end)
      if (!c) return
      if (c.type === 'video') base = c
      else if (c.type === 'text' || c.type === 'sticker') overlays.push(c)
    })
    return { base, overlays }
  }

  function overlaysForFrame(frame: number){
    return getActiveLayers(frame).overlays
  }

  function num(v: any, d: number) { const n = Number(v); return Number.isFinite(n) ? n : d }

  function drawContain(video: HTMLVideoElement, ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const vw = video.videoWidth || 16
    const vh = video.videoHeight || 9
    const cw = canvas.width
    const ch = canvas.height
    const scale = Math.min(cw / vw, ch / vh)
    const dw = vw * scale
    const dh = vh * scale
    const dx = (cw - dw) / 2
    const dy = (ch - dh) / 2
    try { ctx.drawImage(video, dx, dy, dw, dh) } catch {}
  }

  function drawMultiline(ctx: CanvasRenderingContext2D, text: string){
    const lines = String(text).split(/\r?\n/)
    const size = parseInt((ctx.font.match(/(\d+)px/)?.[1] || '24'), 10)
    const lh = size * 1.2
    const startY = 0 - ((lines.length-1)*lh)/2
    for(let i=0;i<lines.length;i++){
      ctx.fillText(lines[i], 0, startY + i*lh)
    }
  }

  function drawMultilineStroke(ctx: CanvasRenderingContext2D, text: string){
    const lines = String(text).split(/\r?\n/)
    const size = parseInt((ctx.font.match(/(\d+)px/)?.[1] || '24'), 10)
    const lh = size * 1.2
    const startY = 0 - ((lines.length-1)*lh)/2
    for(let i=0;i<lines.length;i++){
      ctx.strokeText(lines[i], 0, startY + i*lh)
    }
  }

  function drawMultilineOffset(ctx: CanvasRenderingContext2D, text: string, dx:number, dy:number){
    const lines = String(text).split(/\r?\n/)
    const size = parseInt((ctx.font.match(/(\d+)px/)?.[1] || '24'), 10)
    const lh = size * 1.2
    const startY = 0 - ((lines.length-1)*lh)/2
    for(let i=0;i<lines.length;i++){
      ctx.fillText(lines[i], dx, startY + i*lh + dy)
    }
  }

  type BeautifyOptions = { exposure: number, contrast: number, saturation: number, temperature: number, sharpen: number }
  function applyBeautify(img: ImageData, opt: BeautifyOptions){
    const data = img.data
    const len = data.length
    const brightness = Math.pow(2, opt.exposure || 0)
    const cf = Math.max(0, opt.contrast || 1)
    const warm = Math.max(0.5, Math.min(1.5, (opt.temperature - 6500) / 6500 + 1))
    const sat = Math.max(0, opt.saturation || 1)
    // pass 1: color adjustments
    for (let i=0; i<len; i+=4){
      let r = data[i]
      let g = data[i+1]
      let b = data[i+2]
      r = r * brightness; g = g * brightness; b = b * brightness
      r = r * warm; b = b / warm
      r = (r - 128) * cf + 128
      g = (g - 128) * cf + 128
      b = (b - 128) * cf + 128
      const l = 0.2126*r + 0.7152*g + 0.0722*b
      r = l + (r - l) * sat
      g = l + (g - l) * sat
      b = l + (b - l) * sat
      data[i]   = r < 0 ? 0 : (r > 255 ? 255 : r)
      data[i+1] = g < 0 ? 0 : (g > 255 ? 255 : g)
      data[i+2] = b < 0 ? 0 : (b > 255 ? 255 : b)
    }
    // pass 2: sharpen (simple cross kernel)
    const amount = Math.max(0, Math.min(1, opt.sharpen || 0))
    if (amount > 0){
      const w = img.width, h = img.height
      const src = new Uint8ClampedArray(data)
      const k = amount
      for (let y=1; y<h-1; y++){
        for (let x=1; x<w-1; x++){
          const idx = (y*w + x)*4
          for (let ch=0; ch<3; ch++){
            const c0 = src[idx+ch]
            const up = src[idx - w*4 + ch]
            const dn = src[idx + w*4 + ch]
            const lf = src[idx - 4 + ch]
            const rt = src[idx + 4 + ch]
            let v = (1+4*k)*c0 - k*(up+dn+lf+rt)
            data[idx+ch] = v < 0 ? 0 : (v > 255 ? 255 : v)
          }
          data[idx+3] = src[idx+3]
        }
      }
    }
    return img
  }

  function getVideo(src: string) {
    return new Promise<HTMLVideoElement>((resolve) => {
      if (videos[src]) return resolve(videos[src])
      const v = document.createElement('video')
      v.src = src
      v.crossOrigin = 'anonymous'
      v.preload = 'auto'
      v.muted = true
      v.playsInline = true
      v.addEventListener('loadedmetadata', () => resolve(v), { once: true })
      // in case metadata already loaded
      if (v.readyState >= 1) resolve(v)
      videos[src] = v
    })
  }

  function getImage(src: string){
    if (images[src]) return images[src]
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = src
    images[src] = img
    return img
  }

  function seekVideo(v: HTMLVideoElement, time: number) {
    return new Promise<void>((resolve) => {
      const t = Math.max(0, Math.min(v.duration || time, time))
      const onSeeked = () => { v.removeEventListener('seeked', onSeeked); resolve() }
      v.addEventListener('seeked', onSeeked)
      try { v.currentTime = t } catch { resolve() }
    })
  }

  // respond to timeline changes
  window.addEventListener('ivideo-playhead-change' as any, render)
  window.addEventListener('ivideo-rebuild' as any, render)
  window.addEventListener('ivideo-update-clip' as any, render)
  window.addEventListener('resize', render)
  window.addEventListener('ivideo-export-start' as any, ()=>{ (window as any).__IV_EXPORTING__ = true; render() })
  window.addEventListener('ivideo-export-end' as any, ()=>{ (window as any).__IV_EXPORTING__ = false; render() })
  render()

  // Overlay editors (text & sticker)
  if (overlay) { setupTextOverlay(overlay); setupStickerOverlay(overlay) }

  function setupTextOverlay(layer: HTMLDivElement){
    let el: HTMLDivElement | null = null
    let contentEl: HTMLDivElement | null = null
    let imgEl: HTMLImageElement | null = null
    let dragging: null | { startX:number,startY:number,x0:number,y0:number } = null
    let resizing: null | { startX:number,scale0:number } = null
    let rotating: null | { startX:number,rot0:number } = null

    function ensureEl(){
      if (el) return el
      el = document.createElement('div')
      el.className = 'text-editor'
      el.style.pointerEvents = 'auto'
      el.style.cursor = 'move'
      contentEl = document.createElement('div')
      contentEl.contentEditable = 'false'
      contentEl.style.whiteSpace = 'pre'
      contentEl.style.pointerEvents = 'none'
      el.appendChild(contentEl)
      imgEl = document.createElement('img')
      imgEl.style.maxWidth = '40%'
      imgEl.style.maxHeight = '40%'
      imgEl.style.display = 'none'
      el.appendChild(imgEl)
      const h = document.createElement('div')
      h.className = 'handle'
      el.appendChild(h)
      const r = document.createElement('div')
      r.className = 'handle rotate'
      r.style.right = '-8px'
      r.style.top = '-24px'
      r.style.cursor = 'grab'
      el.appendChild(r)
      layer.appendChild(el)
      // drag
      el.addEventListener('mousedown', (e)=>{
        if ((e.target as HTMLElement).classList.contains('handle')) return
        const c = currentClip()
        if (!c) return
        dragging = { startX: e.clientX, startY: e.clientY, x0: num(c.data?.x,0), y0: num(c.data?.y,0) }
        e.preventDefault()
        e.stopPropagation()
      })
      // resize
      h.addEventListener('mousedown', (e)=>{
        const c = currentClip(); if(!c) return
        resizing = { startX: e.clientX, scale0: num(c.data?.scale,1) }
        e.preventDefault(); e.stopPropagation()
      })
      // rotate
      r.addEventListener('mousedown', (e)=>{
        const c = currentClip(); if(!c) return
        rotating = { startX: e.clientX, rot0: num(c.data?.rotation,0) }
        e.preventDefault(); e.stopPropagation()
      })
      // edit
      el.addEventListener('dblclick', (ev)=>{
        ev.stopPropagation()
        const c = currentClip(); if(!c) return
        if (c.type !== 'text') return
        if (!contentEl) return
        el?.classList.add('editing')
        contentEl.contentEditable = 'true'
        contentEl.style.pointerEvents = 'auto'
        contentEl.focus()
        // 将光标移动到文本末尾
        try {
          const range = document.createRange()
          range.selectNodeContents(contentEl)
          range.collapse(false)
          const sel = window.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(range)
        } catch {}
        contentEl.style.opacity = '1'
        // 标记正在编辑的文本，触发重绘以隐藏画布上的该文本
        try { editingOverlayId = c.id } catch {}
        requestAnimationFrame(render)
      })
      contentEl!.addEventListener('keydown', (e)=>{
        e.stopPropagation()
        if (e.key === 'Enter') { /* 支持换行 */ }
      })
      contentEl!.addEventListener('blur', ()=>{
        const c = currentClip(); if(!c || c.type!=='text') return
        el?.classList.remove('editing')
        contentEl!.contentEditable = 'false'
        contentEl!.style.pointerEvents = 'none'
        updateClipData(c.id, 'content', contentEl!.innerText || '文字')
        // 退出编辑后隐藏覆盖层文字，避免与画布文字叠加
        contentEl!.style.opacity = '0'
        // 退出编辑，恢复画布绘制
        editingOverlayId = null
        requestAnimationFrame(render)
      })
      contentEl!.addEventListener('input', ()=>{
        const c = currentClip(); if(!c || c.type!=='text') return
        // 记录当前光标相对末尾的偏移
        let caretFromEnd = 0
        try {
          const sel = window.getSelection()
          if (sel && sel.anchorNode) {
            const range = document.createRange()
            range.selectNodeContents(contentEl!)
            range.setStart(sel.anchorNode, Math.min(sel.anchorOffset, (sel.anchorNode as any).length||0))
            caretFromEnd = (range.toString() || '').length * -1
          }
        } catch {}
        updateClipData(c.id, 'content', contentEl!.innerText || '文字')
        // 恢复光标到末尾相对偏移（防止跳到最前）
        try {
          const txt = contentEl!.innerText || ''
          const pos = Math.max(0, txt.length + caretFromEnd)
          const range = document.createRange()
          const node = contentEl!.firstChild || contentEl!
          const offset = Math.min(pos, (node as any).length||0)
          range.setStart(node, offset)
          range.collapse(true)
          const sel = window.getSelection()
          sel?.removeAllRanges(); sel?.addRange(range)
        } catch {}
      })
    }

    layer.addEventListener('mousemove', (e)=>{
      const c = currentClip(); if(!c) return
      if (dragging){
        const dx = e.clientX - dragging.startX
        const dy = e.clientY - dragging.startY
        const nx = dragging.x0 + dx
        const ny = dragging.y0 + dy
        positionEl(c, nx, ny, num(c.data?.scale,1), String(c.data?.content||'文字'), String(c.data?.color||'#fff'))
        updateClipData(c.id, 'x', Math.round(nx))
        updateClipData(c.id, 'y', Math.round(ny))
        e.preventDefault()
      } else if (resizing){
        const dx = e.clientX - resizing.startX
        const ns = Math.max(0.2, resizing.scale0 + dx/200)
        positionEl(c, num(c.data?.x,0), num(c.data?.y,0), ns, String(c.data?.content||'文字'), String(c.data?.color||'#fff'))
        updateClipData(c.id, 'scale', Number(ns.toFixed(2)))
        e.preventDefault()
      } else if (rotating){
        const dx = e.clientX - rotating.startX
        const nr = (rotating.rot0 + dx) % 360
        // 仅预览位置旋转，保存到数据
        const scale = num(c.data?.scale,1)
        const x = num(c.data?.x,0)
        const y = num(c.data?.y,0)
        ensureEl(); if(el){ el.style.transform = `translate(-50%,-50%) scale(${scale}) rotate(${nr}deg)` }
        updateClipData(c.id, 'rotation', Math.round(nr))
        e.preventDefault()
      }
    })
    layer.addEventListener('mouseup', ()=>{
      const c = currentClip()
      if (c && el){
        if (dragging){
          const layerRect = layer.getBoundingClientRect()
          const left = parseFloat(el.style.left || '0')
          const top = parseFloat(el.style.top || '0')
          const nx = Math.round(left - layerRect.width/2)
          const ny = Math.round(top - layerRect.height/2)
          updateClipData(c.id,'x', nx)
          updateClipData(c.id,'y', ny)
        }
        if (resizing){
          const scale = parseFloat(el.style.getPropertyValue('--scale') || '') || num(c.data?.scale,1)
          updateClipData(c.id, 'scale', scale)
        }
        if (rotating){ /* rotation 已在 mousemove 中实时写入 */ }
      }
      dragging=null; resizing=null; rotating=null
    })

    function currentClip(){
      const id = ui.selectedClipId
      if (!id) return null
      const frame = ui.playhead
      for (const t of pj.tracks){
        const c = t.clips.find(c=>c.id===id)
        // 仅支持文本在覆盖层编辑；贴图不在覆盖层显示，避免与画布贴图叠层
        if (c && c.type==='text' && frame>=c.start && frame<c.end) return c
      }
      return null
    }

    function updateClipData(id: string, key: string, value: any){
      try { (useProjectStore() as any).updateClipDataKey(id, key, value) } catch {}
      const ev = new CustomEvent('ivideo-update-clip', { detail: { id, key, value } })
      window.dispatchEvent(ev)
    }

    function positionEl(c:any, x:number, y:number, scale:number, content:string, color:string){
      ensureEl()
      if (!el || !contentEl) return
      const layerRect = layer.getBoundingClientRect()
      const cx = layerRect.width/2 + x
      const cy = layerRect.height/2 + y
      el.style.left = cx + 'px'
      el.style.top = cy + 'px'
      const rot = num(c.data?.rotation,0)
      el.style.transform = `translate(-50%,-50%) scale(${scale}) rotate(${rot}deg)`
      el.style.setProperty('--scale', String(scale))
      if (c.type === 'text'){
        contentEl.style.display='block'; imgEl && (imgEl.style.display='none')
        contentEl.innerText = content
        el.style.color = color
        // 同步属性到可编辑覆盖层，避免与画布显示不一致
        const fontSize = Math.max(8, num(c.data?.fontSize, 28))
        const opacity = Math.max(0, Math.min(1, num(c.data?.opacity, 1)))
        contentEl.style.fontSize = fontSize + 'px'
        el.style.opacity = String(opacity)
        // 非编辑态隐藏覆盖层文字，只显示框与把手，避免与画布文字叠影
        const isEditing = el.classList.contains('editing')
        contentEl.style.opacity = isEditing ? '1' : '0'
      } else if (c.type === 'sticker'){
        contentEl.style.display='none'; if (imgEl){ imgEl.style.display='block'; imgEl.src = String(c.data?.source||'') }
      }
      el.style.display = ''
    }

    function hide(){ if(el) el.style.display='none' }

    function refresh(){
      const id = ui.selectedClipId
      if (!id){ hide(); return }
      const c = currentClip()
      if (!c){ hide(); return }
      // 确保使用 clip.data 中的坐标，不做任何自动居中覆盖
      positionEl(c, Number(c.data?.x||0), Number(c.data?.y||0), Number(c.data?.scale||1), String(c.data?.content||'文字'), String(c.data?.color||'#fff'))
    }

    window.addEventListener('ivideo-playhead-change' as any, refresh)
    window.addEventListener('ivideo-update-clip' as any, refresh)
    window.addEventListener('ivideo-rebuild' as any, refresh)
    window.addEventListener('ivideo-selection-change' as any, refresh)
    refresh()
  }

  function setupStickerOverlay(layer: HTMLDivElement){
    let box: HTMLDivElement | null = null
    let dragging: null | { startX:number,startY:number,x0:number,y0:number,id:string } = null
    let resizing: null | { startX:number,scale0:number,id:string } = null
    let rotating: null | { startX:number,rot0:number,id:string } = null

    function ensure(){
      if (box) return box
      box = document.createElement('div')
      box.className = 'text-editor' // 复用样式外框
      box.style.pointerEvents = 'auto'
      const h = document.createElement('div')
      h.className = 'handle'
      h.style.right = '-8px'
      h.style.top = '50%'
      h.style.transform = 'translateY(-50%)'
      box.appendChild(h)
      const r = document.createElement('div')
      r.className = 'handle rotate'
      r.style.right = '-8px'
      r.style.bottom = '-24px'
      r.style.cursor = 'grab'
      box.appendChild(r)
      layer.appendChild(box)
      // drag
      box.addEventListener('mousedown', (e)=>{
        if ((e.target as HTMLElement).classList.contains('handle')) return
        const c = currentSticker()
        if (!c) return
        const x0 = num(c.data?.x,0), y0 = num(c.data?.y,0)
        dragging = { startX: e.clientX, startY: e.clientY, x0, y0, id:c.id }
        e.preventDefault(); e.stopPropagation();
      })
      // resize
      h.addEventListener('mousedown', (e)=>{
        const c = currentSticker(); if(!c) return
        resizing = { startX: e.clientX, scale0: num(c.data?.scale,1), id:c.id }
        e.preventDefault(); e.stopPropagation();
      })
      // rotate
      r.addEventListener('mousedown', (e)=>{
        const c = currentSticker(); if(!c) return
        rotating = { startX: e.clientX, rot0: num(c.data?.rotation,0), id:c.id }
        e.preventDefault(); e.stopPropagation();
      })
      return box
    }

    function currentSticker(){
      const id = ui.selectedClipId
      if (!id) return null
      const frame = ui.playhead
      for (const t of pj.tracks){
        const c = t.clips.find(c=>c.id===id)
        if (c && c.type==='sticker' && frame>=c.start && frame<c.end) return c
      }
      return null
    }

    function positionBox(){
      const c = currentSticker(); if(!c){ if(box) box.style.display='none'; return }
      ensure(); if(!box) return
      const layerRect = layer.getBoundingClientRect()
      const cx = layerRect.width/2 + num(c.data?.x,0)
      const cy = layerRect.height/2 + num(c.data?.y,0)
      const scale = num(c.data?.scale,1)
      const rot = num(c.data?.rotation,0)
      // 依据贴图真实显示尺寸设定外框宽高（与画布绘制一致）
      const src = String(c.data?.source||'')
      const img = src ? getImage(src) : null
      let w = 160, h = 90
      if (img && (img.naturalWidth||img.width)){
        const iw = img.naturalWidth || 200, ih = img.naturalHeight || 200
        const max = Math.min(canvas.width, canvas.height) * 0.4
        const s = Math.min(max/iw, max/ih)
        w = iw * s * scale
        h = ih * s * scale
      }
      box.style.width = Math.max(20, Math.floor(w)) + 'px'
      box.style.height = Math.max(20, Math.floor(h)) + 'px'
      box.style.left = cx + 'px'
      box.style.top = cy + 'px'
      // 不再对外框应用 scale，避免把手位置受缩放影响；仅应用旋转
      box.style.transform = `translate(-50%,-50%) rotate(${rot}deg)`
      box.style.display = ''
    }

    layer.addEventListener('mousemove', (e)=>{
      const c = currentSticker(); if(!c) return
      if (dragging){
        const dx = e.clientX - dragging.startX
        const dy = e.clientY - dragging.startY
        const nx = dragging.x0 + dx
        const ny = dragging.y0 + dy
        ;(useProjectStore() as any).updateClipDataKey(c.id,'x', Math.round(nx))
        ;(useProjectStore() as any).updateClipDataKey(c.id,'y', Math.round(ny))
        positionBox(); e.preventDefault()
      } else if (resizing){
        const dx = e.clientX - resizing.startX
        const ns = Math.max(0.2, resizing.scale0 + dx/200)
        ;(useProjectStore() as any).updateClipDataKey(c.id,'scale', Number(ns.toFixed(2)))
        positionBox(); e.preventDefault()
      } else if (rotating){
        const dx = e.clientX - rotating.startX
        // 方向修正：向右拖动为顺时针（角度增大）时，视觉上需要反向补偿
        const nr = (rotating.rot0 - dx) % 360
        ;(useProjectStore() as any).updateClipDataKey(c.id,'rotation', Math.round(nr))
        positionBox(); e.preventDefault()
      }
    })
    layer.addEventListener('mouseup', ()=>{ dragging=null; resizing=null; rotating=null; editingOverlayId=null; requestAnimationFrame(render) })

    window.addEventListener('ivideo-playhead-change' as any, positionBox)
    window.addEventListener('ivideo-update-clip' as any, positionBox)
    window.addEventListener('ivideo-rebuild' as any, positionBox)
    window.addEventListener('ivideo-selection-change' as any, positionBox)
    positionBox()
  }
}
