import type { Clip } from '../types'
import { useProjectStore } from '../store/project'
import { useUIStore } from '../store/ui'

type ClipEl = HTMLElement & { dataset: DOMStringMap }

export function initTimeline(root: HTMLElement) {
  const pj = useProjectStore()
  const ui = useUIStore()

  const content = root.querySelector('[data-role=content]') as HTMLElement
  const scrollCont = root.querySelector('.scroll') as HTMLElement
  const ruler = root.querySelector('[data-role=ruler]') as HTMLElement
  const tracks = root.querySelector('[data-role=tracks]') as HTMLElement
  const playhead = root.querySelector('[data-role=playhead]') as HTMLElement
  const actions = root.querySelector('.timeline-actions') as HTMLElement
  const zoomRange = root.querySelector('[data-role=zoom]') as HTMLInputElement
  const trackHeightRange = root.querySelector('[data-role=track-height]') as HTMLInputElement

  const state = { fps: pj.fps || 30, durationFrames: pj.durationFrames || 300, pxPerFrame: ui.pxPerFrame || 6 }

  let selectedClip: ClipEl | null = null

  const framesToPx = (f:number)=> f * state.pxPerFrame
  const pxToFrames = (px:number)=> Math.round(px / state.pxPerFrame)
  const labelWidthPx = ()=> parseInt(getComputedStyle(document.documentElement).getPropertyValue('--track-label-width')||'140') || 140

  function setContentWidth(){
    const framesW = framesToPx(state.durationFrames)
    const totalW = framesW + labelWidthPx()
    content.style.width = `${totalW}px`
    ruler.style.marginLeft = `${labelWidthPx()}px`
    ;(ruler.style as any).width = `${framesW}px`
  }
  function updateRuler(){
    ruler.innerHTML = ''
    const frag = document.createDocumentFragment()
    const fps = state.fps
    for (let f=0; f<=state.durationFrames; f+=1){
      const x = framesToPx(f)
      const tick = document.createElement('div')
      const isMajor = f % fps === 0
      tick.className = 'tick ' + (isMajor ? 'major' : 'minor')
      ;(tick.style as any).left = `${x}px`
      frag.appendChild(tick)
      if (isMajor){
        const s = Math.floor(f/fps), ff=f%fps, m=Math.floor(s/60), ss=s%60
        const pad=(n:number)=> String(n).padStart(2,'0')
        const label = document.createElement('div')
        label.className='label'; (label.style as any).left = `${x}px`
        label.textContent = `${pad(m)}:${pad(ss)}:${pad(ff)}`
        frag.appendChild(label)
      }
    }
    ruler.appendChild(frag)
  }
  function layoutClips(){
    tracks.querySelectorAll<ClipEl>('.clip').forEach(el=>{
      const s = parseInt(el.dataset.start||'0',10)
      const e = parseInt(el.dataset.end||'0',10)
      ;(el.style as any).left = `${framesToPx(s)}px`
      ;(el.style as any).width = `${Math.max(1, framesToPx(e-s))}px`
    })
  }
  function positionPlayhead(fr:number){
    fr = Math.max(0, Math.min(fr, state.durationFrames))
    const x = labelWidthPx() + framesToPx(fr)
    playhead.style.left = `${x}px`
    ;(playhead as any).dataset.frame = String(fr)
    ui.setPlayhead(fr)
    window.dispatchEvent(new CustomEvent('ivideo-playhead-change',{ detail:{ frame: fr }}))
  }
  function frameFromEvent(ev:MouseEvent){
    const rect = content.getBoundingClientRect()
    const viewX = ev.clientX - rect.left
    const x = viewX + (scrollCont?.scrollLeft||0) - labelWidthPx()
    return pxToFrames(Math.max(0, x))
  }

  function mapName(type:string){ return ({video:'视频',audio:'音频',text:'文本',sticker:'贴图'} as any)[type] || '轨道' }
  function rebuildHeadersSimple(){
    tracks.querySelectorAll('.track').forEach(tr=>{
      const header = tr.querySelector('.track-label') as HTMLElement
      if (!header) return
      const cls = Array.from((tr as HTMLElement).classList)
      const typeCls = ((cls.find(c=>['video','audio','text','sticker'].includes(c)))||'track') as string
      header.innerHTML = ''
      const name = document.createElement('span'); name.className='name'; name.textContent = mapName(typeCls)
      const ctrls = document.createElement('span'); ctrls.className='track-ctrls'
      const up=document.createElement('button'); up.className='trk-btn'; up.dataset.cmd='up'; up.textContent='\u2191'
      const down=document.createElement('button'); down.className='trk-btn'; down.dataset.cmd='down'; down.textContent='\u2193'
      const del=document.createElement('button'); del.className='trk-btn'; del.dataset.cmd='delete'; del.textContent='\u2715'
      ctrls.appendChild(up); ctrls.appendChild(down); ctrls.appendChild(del)
      header.appendChild(name); header.appendChild(ctrls)
    })
  }

  function attachTrackHandlers(track:HTMLElement){
    // 事件代理绑定在 track 上，避免 rebuildHeadersSimple 重建 header 后丢失监听
    track.addEventListener('click', ev=>{
      const btn = (ev.target as HTMLElement).closest('.trk-btn') as HTMLElement|null
      if(!btn || !track.contains(btn)) return
      ev.stopPropagation()
      const cmd = btn.dataset.cmd
      const trackId = (track as HTMLElement).getAttribute('data-track-id')||''
      const idx = pj.tracks.findIndex(t=>t.id===trackId)
      if (idx<0) return
      if (cmd==='delete'){
        ;(useProjectStore() as any).pushHistory()
        pj.tracks.splice(idx,1); track.remove()
      } else if (cmd==='up'){
        const prev = track.previousElementSibling; if(prev){
          ;(useProjectStore() as any).pushHistory()
          track.parentElement!.insertBefore(track, prev); const [t]=pj.tracks.splice(idx,1); pj.tracks.splice(Math.max(0,idx-1),0,t)
        }
      } else if (cmd==='down'){
        const next = track.nextElementSibling; if(next){
          ;(useProjectStore() as any).pushHistory()
          track.parentElement!.insertBefore(next, track); const [t]=pj.tracks.splice(idx,1); pj.tracks.splice(Math.min(idx+1,pj.tracks.length),0,t)
        }
      }
      // 轨道顺序变更后，通知预览重绘
      window.dispatchEvent(new Event('ivideo-rebuild'))
    })
  }
  function selectClip(el:ClipEl|null){
    if (selectedClip) selectedClip.classList.remove('selected')
    selectedClip = el
    if (selectedClip) selectedClip.classList.add('selected')
    const id = selectedClip?.dataset.id || null
    ui.setSelectedClip(id as any)
    window.dispatchEvent(new CustomEvent('ivideo-selection-change',{ detail:{ id }}))
  }
  function attachClipHandlers(el:ClipEl){
  el.addEventListener('mousedown', (e)=>{
    const target = e.target as HTMLElement
    const isHandle = target.classList.contains('handle')
    selectClip(el)
    if (isHandle){
      const side = target.getAttribute('data-side') === 'r' ? 'r' : 'l'
      startTrim(e as MouseEvent, el, side as 'l'|'r')
    } else {
      startDragMove(e as MouseEvent, el)
    }
    e.stopPropagation()
  })
}

function startDragMove(ev:MouseEvent, el:ClipEl){
  const s0 = parseInt(el.dataset.start||'0',10)
  const e0 = parseInt(el.dataset.end||'0',10)
  const len = e0 - s0
  const x0 = ev.clientX
  function onMove(e:MouseEvent){
    const dx = e.clientX - x0
    const df = Math.round(dx / (useUIStore().pxPerFrame || 6))
    let ns = Math.max(0, Math.min(s0+df, state.durationFrames - len))
    el.dataset.start = String(ns)
    el.dataset.end = String(ns + len)
    layoutClips()
  }
  function onUp(){
    document.removeEventListener('mousemove', onMove)
    const id = el.dataset.id||''
    const ns = parseInt(el.dataset.start||'0',10)
    const ne = parseInt(el.dataset.end||'0',10)
    const t = useProjectStore().tracks.find(T=>T.clips.some(c=>c.id===id))
    if (t){ const i=t.clips.findIndex(c=>c.id===id); if(i>=0){ (useProjectStore() as any).pushHistory(); t.clips[i].start=ns; t.clips[i].end=ne } }
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp, { once:true })
}

function startTrim(ev:MouseEvent, el:ClipEl, side:'l'|'r'){
  const s0 = parseInt(el.dataset.start||'0',10)
  const e0 = parseInt(el.dataset.end||'0',10)
  const x0 = ev.clientX
  function onMove(e:MouseEvent){
    const dx = e.clientX - x0
    const df = Math.round(dx / (useUIStore().pxPerFrame || 6))
    if (side==='l'){
      let ns = Math.max(0, Math.min(s0+df, e0-1))
      el.dataset.start = String(ns)
    } else {
      let ne = Math.max(s0+1, Math.min(e0+df, state.durationFrames))
      el.dataset.end = String(ne)
    }
    layoutClips()
  }
  function onUp(){
    document.removeEventListener('mousemove', onMove)
    const id = el.dataset.id||''
    const ns = parseInt(el.dataset.start||'0',10)
    const ne = parseInt(el.dataset.end||'0',10)
    const t = useProjectStore().tracks.find(T=>T.clips.some(c=>c.id===id))
    if (t){ const i=t.clips.findIndex(c=>c.id===id); if(i>=0){ (useProjectStore() as any).pushHistory(); t.clips[i].start=ns; t.clips[i].end=ne } }
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp, { once:true })
}
  function createClipEl(c:Clip){
    const el = document.createElement('div') as ClipEl
    el.className = `clip clip-${c.type}`
    el.dataset.id=c.id; el.dataset.type=c.type as any; el.dataset.start=String(c.start); el.dataset.end=String(c.end)
    el.textContent = (c.type==='text' ? (c.data?.content||'文字') : (c.label||c.source||c.type)) + ' '
    el.innerHTML += '<i class="handle l" data-side="l"></i><i class="handle r" data-side="r"></i>'
    attachClipHandlers(el)
    return el
  }
  function rebuildFromStore(){
    // 全量重建，保证 DOM 轨道顺序与 store 一致（底->顶）
    const selectedId = (selectedClip as any)?.dataset?.id || null
    tracks.innerHTML = ''
    pj.tracks.forEach(t=>{
      const tr = document.createElement('div')
      tr.className = `track ${t.type}`
      tr.setAttribute('data-track-id', t.id)
      tr.innerHTML = `<div class="track-label"><span class="name">${mapName(t.type as any)}</span><span class="track-ctrls"></span></div><div class="lane"></div>`
      const lane = tr.querySelector('.lane') as HTMLElement
      t.clips.forEach(c=> {
        // 确保资产卡存在（用于用户上传资源“丢失”的视觉问题）
        const label = c.label || ''
        const url = (c as any).source || (c.data as any)?.source || ''
        if (c.type==='video' || c.type==='audio' || c.type==='sticker'){
          if (url) window.dispatchEvent(new CustomEvent('ivideo-ensure-asset-card', { detail: { type: c.type, url, label, durationFrames: c.end - c.start } }))
        }
        lane.appendChild(createClipEl(c))
      })
      tracks.appendChild(tr)
      attachTrackHandlers(tr)
    })
    rebuildHeadersSimple(); layoutClips()
    if (selectedId){ const el = tracks.querySelector(`.clip[data-id="${selectedId}"]`) as ClipEl|null; if(el) selectClip(el) }
  }
  function addTrack(type:string){
    ;(useProjectStore() as any).pushHistory()
    const t = pj.addTrack(type as any)!
    const tr = document.createElement('div')
    tr.className = `track ${type}`
    tr.setAttribute('data-track-id', t.id)
    tr.innerHTML = `<div class="track-label"><span class="name">${mapName(type)}</span><span class="track-ctrls"></span></div><div class="lane"></div>`
  if (type==='text' || type==='sticker') tracks.insertBefore(tr, tracks.firstChild)
  else tracks.appendChild(tr)
  attachTrackHandlers(tr); rebuildHeadersSimple()
  }

  // bootstrap: ensure store tracks for existing DOM tracks
  if (pj.tracks.length === 0){
    tracks.querySelectorAll('.track').forEach(tr=>{
      const cls = Array.from((tr as HTMLElement).classList)
      const type = ((cls.find(c=>['video','audio','text','sticker'].includes(c))||'video')) as string
      const t = pj.addTrack(type as any)!
      tr.setAttribute('data-track-id', t.id)
    })
  }
  // attach handlers to existing
  tracks.querySelectorAll('.track').forEach(tr=> attachTrackHandlers(tr as HTMLElement))

  // drag & drop from assets panel into lanes
  tracks.addEventListener('dragover', (ev:any)=>{
    const dt = ev.dataTransfer
    if (!dt) return
    if (Array.from(dt.types||[]).includes('application/ivideo-asset')) {
      ev.preventDefault()
    }
  })
  tracks.addEventListener('drop', (ev:any)=>{
    const dt = ev.dataTransfer
    if (!dt) return
    const json = dt.getData('application/ivideo-asset')
    if (!json) return
    ev.preventDefault()
    let asset:any
    try { asset = JSON.parse(json) } catch { return }
    const lane = (ev.target as HTMLElement).closest('.lane') as HTMLElement|null
    const trackEl = lane?.closest('.track') as HTMLElement|null
    const trackType = trackEl ? (Array.from(trackEl.classList).find(c=>['video','audio','text','sticker'].includes(c)) || 'video') : 'video'
    const desiredType = (asset.type || (asset?.type)) as string
    let finalType = desiredType
    if (!['video','audio','text','sticker'].includes(finalType)) finalType = trackType

    function ensureTrackId(kind:string){
      // if current track matches kind, use it; else find existing or create
      if (trackEl){
        const curType = trackType
        if (curType === kind){
          return trackEl.getAttribute('data-track-id') || ''
        }
      }
      const existing = tracks.querySelector(`.track.${kind}`) as HTMLElement|null
      if (existing) return existing.getAttribute('data-track-id') || ''
      // create
      addTrack(kind)
      let created: HTMLElement | null = null
      if (kind==='text' || kind==='sticker') {
        created = tracks.querySelector(`.track.${kind}`) as HTMLElement|null
      } else {
        created = Array.from(tracks.querySelectorAll(`.track.${kind}`)).pop() as HTMLElement|null
      }
      return created?.getAttribute('data-track-id') || ''
    }

    const trackId = ensureTrackId(finalType)
    if (!trackId) return
    ;(useProjectStore() as any).pushHistory()
    const start = frameFromEvent(ev as MouseEvent)
    const duration = Math.max(1, Number(asset.durationFrames|| (state.fps*3)))
    const label = String(asset.label||'')
    const source = String(asset.url||'')
    window.dispatchEvent(new CustomEvent('ivideo-add-clip', { detail: { trackId, type: finalType, start, duration, label, source } }))
  })

  setContentWidth(); updateRuler(); layoutClips(); rebuildHeadersSimple(); positionPlayhead(ui.playhead||0)

  // actions
  actions.addEventListener('click', (ev)=>{
    const btn = (ev.target as HTMLElement).closest('[data-action]') as HTMLElement
    if (!btn) return
    const act = btn.dataset.action
    if (act==='split'){
      if (!selectedClip) return
      const s = parseInt(selectedClip.dataset.start||'0',10)
      const e = parseInt(selectedClip.dataset.end||'0',10)
      const fr = parseInt((playhead as any).dataset.frame||'0',10)
      if (fr<=s || fr>=e) return
      // update store
      const id = selectedClip.dataset.id||''
      const t = pj.tracks.find(T=>T.clips.some(c=>c.id===id))
      if (!t) return
      ;(useProjectStore() as any).pushHistory()
      const idx = t.clips.findIndex(c=>c.id===id)
      const original = t.clips[idx]
      // 保持前后长度不变：前半段结束=fr，后半段开始=fr
      const left: Clip = { ...original, id: original.id, end: fr }
      const right: Clip = { ...JSON.parse(JSON.stringify(original)), id: 'c_'+Math.random().toString(36).slice(2,9), start: fr }
      t.clips.splice(idx, 1, left, right)
      rebuildFromStore(); layoutClips(); selectClip(tracks.querySelector(`.clip[data-id="${right.id}"]`) as any)
    } else if (act==='delete'){
      if (!selectedClip) return
      const id = selectedClip.dataset.id||''
      ;(useProjectStore() as any).pushHistory()
      pj.tracks.forEach(t=>{ const i=t.clips.findIndex(c=>c.id===id); if(i>=0) t.clips.splice(i,1) })
      selectedClip.remove(); selectedClip=null
    } else if (act==='undo'){
      ;(useProjectStore() as any).undo(); rebuildFromStore(); layoutClips()
    } else if (act==='redo'){
      ;(useProjectStore() as any).redo(); rebuildFromStore(); layoutClips()
    } else if (act==='add-track'){
      const type = btn.dataset.type || 'video'
      addTrack(type)
    }
  })

  // move playhead by ruler
  let draggingHead = false
  content.addEventListener('mousedown', (ev)=>{
    const target = ev.target as HTMLElement
    // 点击片段或轨道标签/按钮时，不移动播放头
    if (target.closest('.clip') || target.closest('.track-label') || target.closest('.track-ctrls')) return
    draggingHead=true; positionPlayhead(frameFromEvent(ev))
  })
  window.addEventListener('mousemove', (ev)=>{ if(!draggingHead) return; positionPlayhead(frameFromEvent(ev as MouseEvent)) })
  window.addEventListener('mouseup', ()=> draggingHead=false )
  playhead.addEventListener('mousedown', (ev)=>{ draggingHead=true; ev.preventDefault() })

  // inputs
  zoomRange?.addEventListener('input', ()=>{ state.pxPerFrame = parseInt(zoomRange.value,10)||state.pxPerFrame; ui.setPxPerFrame(state.pxPerFrame); setContentWidth(); updateRuler(); layoutClips(); positionPlayhead(parseInt((playhead as any).dataset.frame||'0',10)) })
  trackHeightRange?.addEventListener('input', ()=>{ document.documentElement.style.setProperty('--track-height', trackHeightRange.value+'px') })

  // ext events
  window.addEventListener('ivideo-update-clip' as any, (e:any)=>{
    const { id, key, value } = e.detail||{}
    const el = tracks.querySelector(`.clip[data-id="${id}"]`) as ClipEl|null
    if (!el) return
    ;(el.dataset as any)[key]=value
    if (key==='opacity') (el.style as any).opacity = value
  })
  window.addEventListener('ivideo-rebuild' as any, ()=>{ rebuildFromStore(); setContentWidth(); updateRuler(); rebuildHeadersSimple(); layoutClips(); positionPlayhead(ui.playhead||0) })
  window.addEventListener('ivideo-set-playhead' as any, (e:any)=>{ const fr = Math.round(Number((e.detail||{}).frame)||0); positionPlayhead(fr) })
  window.addEventListener('ivideo-add-clip' as any, (e:any)=>{
    const { trackId, type, start, duration, label, source } = e.detail||{}
    if (!trackId || !type) return
    const end = Math.max(start+1,(start||0)+(duration|| state.fps*3))
    let data:any = { source, label }
    if (type==='text') data = { content: label||'文字', color:'#ffffff', scale:1, x:0, y:0, rotation:0, fontSize:28 }
    if (type==='sticker') data = { source, scale:1, x:0, y:0, rotation:0, opacity:1 }
    const clip: Clip = { id: 'c_'+Math.random().toString(36).slice(2,9), type, start, end, data, label }
    const tr = pj.tracks.find(t=>t.id===trackId); if(!tr) return
    tr.clips.push(clip)
    const lane = tracks.querySelector(`.track[data-track-id="${trackId}"] .lane`) as HTMLElement
    lane?.appendChild(createClipEl(clip))
    if (end>state.durationFrames){ state.durationFrames=end; pj.durationFrames=end; setContentWidth(); updateRuler() }
    layoutClips(); if (type==='text' || type==='sticker'){ const el = lane.querySelector(`.clip[data-id="${clip.id}"]`) as ClipEl|null; if(el) selectClip(el) }
  })
}


