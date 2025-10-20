import { useProjectStore } from '../store/project'
import { useUIStore } from '../store/ui'

type UploadAsset = {
  url: string
  type: 'video'|'audio'|'sticker'
  label: string
  durationFrames: number
}

const FPS_FALLBACK = 30

export function setupAssetsUI() {
  const dock = document.querySelector('.dock') as HTMLElement
  const btnUpload = document.getElementById('btnUpload') as HTMLButtonElement
  const fileInput = document.getElementById('fileInput') as HTMLInputElement
  const pj = useProjectStore()
  const ui = useUIStore()

  const lists: Record<string, HTMLElement | null> = {
    video: document.getElementById('assetsVideo'),
    audio: document.getElementById('assetsAudio'),
    text: document.getElementById('assetsText'),
    sticker: document.getElementById('assetsSticker')
  }

  let active: 'video'|'audio'|'text'|'sticker' = 'video'
  applyActive()

  // Dock active state
  dock?.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('.tool') as HTMLElement
    if (!btn) return
    dock.querySelectorAll('.tool').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    const cat = btn.getAttribute('data-cat') as any
    if (cat) { active = cat; applyActive() }
  })

  btnUpload?.addEventListener('click', () => {
    if (active === 'text') {
      // 用小面板方式而非浏览器弹窗
      const panel = document.createElement('div')
      panel.style.position = 'fixed'
      panel.style.inset = '0'
      panel.style.display = 'grid'
      panel.style.placeItems = 'center'
      panel.style.background = 'rgba(0,0,0,0.45)'
      panel.innerHTML = `
        <div style="background:#111827;border:1px solid #263445;border-radius:10px;padding:14px 16px;min-width:320px;box-shadow:0 10px 30px rgba(0,0,0,.35);">
          <div style="color:#cbd5e1;font-weight:600;margin-bottom:10px;">新建文本</div>
          <div style="display:grid;gap:10px;">
            <input id="iv-text-content" style="background:#0b1118;border:1px solid #2b3a4d;border-radius:6px;color:#fff;padding:8px" placeholder="内容（可留空为 文字）" />
            <div style="display:grid;grid-template-columns:1fr 80px;gap:8px;align-items:center;">
              <label style="color:#94a3b8">持续(秒)</label>
              <input id="iv-text-duration" type="number" min="1" max="600" value="3" style="background:#0b1118;border:1px solid #2b3a4d;border-radius:6px;color:#fff;padding:6px 8px;" />
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
              <button id="iv-text-cancel" class="btn ghost">取消</button>
              <button id="iv-text-ok" class="btn primary">确定</button>
            </div>
          </div>
        </div>`
      document.body.appendChild(panel)
      const close = ()=> panel.remove()
      ;(panel.querySelector('#iv-text-cancel') as HTMLButtonElement).onclick = close
      ;(panel.querySelector('#iv-text-ok') as HTMLButtonElement).onclick = ()=>{
        const content = String((panel.querySelector('#iv-text-content') as HTMLInputElement).value || '文字')
        const dur = Math.max(1, Math.round(Number((panel.querySelector('#iv-text-duration') as HTMLInputElement).value || '3')))
        const durFrames = Math.max(1, Math.round(dur * (useProjectStore().fps || 30)))
        const asset: UploadAsset = { url: '', type: 'text' as any, label: content, durationFrames: durFrames }
        const card = renderAssetCard(asset as any)
        lists.text?.appendChild(card)
        close()
      }
      return
    }
    if (active === 'sticker') fileInput.accept = 'image/*'
    else if (active === 'audio') fileInput.accept = 'audio/*'
    else fileInput.accept = 'video/*'
    fileInput?.click()
  })

  fileInput?.addEventListener('change', async () => {
    const files = fileInput.files
    if (!files) return
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file)
      const label = file.name
      let type = classify(file.type)
      if (active === 'sticker' && !file.type.startsWith('image/')) type = 'sticker'
      const durationFrames = await probeDurationFrames(url, file.type, pj.fps || FPS_FALLBACK)
      const asset: UploadAsset = { url, type, label, durationFrames }
      const container = lists[type === 'video' ? 'video' : (type === 'audio' ? 'audio' : 'sticker')]
      container?.appendChild(renderAssetCard(asset))
    }
    fileInput.value = ''
  })

  function renderAssetCard(asset: UploadAsset) {
    const el = document.createElement('div')
    el.className = 'asset'
    el.draggable = true
    el.title = `${asset.label}\n${asset.type} ${asset.durationFrames} 帧`
    el.style.backgroundSize = 'cover'
    el.style.backgroundPosition = 'center'
    el.textContent = ''
    const label = document.createElement('div')
    label.style.position = 'absolute'
    label.style.left = '8px'
    label.style.top = '6px'
    label.style.fontWeight = '600'
    label.style.textShadow = '0 1px 2px rgba(0,0,0,0.5)'
    label.textContent = asset.label
    el.appendChild(label)
    const badge = document.createElement('div')
    badge.className = 'badge'
    badge.textContent = framesToTime(asset.durationFrames)
    el.appendChild(badge)
    const mask = document.createElement('div')
    mask.className = 'mask'
    el.appendChild(mask)
    // preview cover
    if (asset.type === 'video') createVideoThumb(asset.url).then(url => { if (url) el.style.backgroundImage = `url('${url}')` })
    if (asset.type === 'sticker') el.style.backgroundImage = `url('${asset.url}')`
    if (asset.type === 'audio') label.textContent = '🎵 ' + asset.label
    el.dataset.asset = JSON.stringify(asset)
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('application/ivideo-asset', JSON.stringify(asset))
      e.dataTransfer?.setDragImage(el, 10, 10)
    })
    el.addEventListener('dblclick', () => {
      const tracks = document.querySelector('.timeline .tracks') as HTMLElement
      let selector = '.track.video'
      if (asset.type === 'audio') selector = '.track.audio'
      else if ((asset as any).type === 'text') selector = '.track.text'
      else if ((asset as any).type === 'sticker') selector = '.track.sticker'
      const track = tracks?.querySelector(selector) as HTMLElement
      const trackId = track?.getAttribute('data-track-id') || findAnyTrackId((asset as any).type || asset.type)
      if (!trackId) return
      const start = ui.playhead || 0
      const type = (asset as any).type || asset.type
      window.dispatchEvent(new CustomEvent('ivideo-add-clip', { detail: { trackId, type, start, duration: asset.durationFrames, label: asset.label, source: asset.url } }))
    })
    return el
  }

  // 加载项目时，要求左侧资产面板补一张卡片（若无）
  window.addEventListener('ivideo-ensure-asset-card' as any, (e:any)=>{
    const { type, url, label, durationFrames } = e.detail || {}
    if (!type || !url) return
    const container = lists[type === 'video' ? 'video' : (type === 'audio' ? 'audio' : 'sticker')]
    if (!container) return
    const exists = Array.from(container.querySelectorAll('.asset')).some((el:any)=>{
      try { const a = JSON.parse(el.dataset.asset||'{}'); return a.url===url } catch { return false }
    })
    if (exists) return
    const card = renderAssetCard({ type, url, label: label||url.split('/').pop()||type, durationFrames: durationFrames|| (pj.fps||FPS_FALLBACK)*3 } as any)
    container.appendChild(card)
  })

  function findAnyTrackId(kind: 'video'|'audio'|'text'|'sticker'){
    const tracks = document.querySelector('.timeline .tracks') as HTMLElement
    let selector = '.track.video'
    if (kind === 'audio') selector = '.track.audio'
    else if (kind === 'text') selector = '.track.text'
    else if (kind === 'sticker') selector = '.track.sticker'
    const t = tracks?.querySelector(selector) as HTMLElement
    return t?.getAttribute('data-track-id') || ''
  }
  function applyActive(){
    // toggle accept & section title highlight
    document.querySelectorAll('.assets-category').forEach(s=> s.classList.remove('active'))
    const map: any = { video: '用户上传（视频）', audio: '用户上传（音频）', text: '用户上传（文本）', sticker: '用户上传（贴图）' }
    const title = document.querySelector('.assets-title') as HTMLElement
    if (title) title.textContent = map[active] || '用户上传'
    if (active==='video') lists.video?.classList.add('active')
    if (active==='audio') lists.audio?.classList.add('active')
    if (active==='text') lists.text?.classList.add('active')
    if (active==='sticker') lists.sticker?.classList.add('active')
  }
}

function framesToTime(fr: number, fps=30){
  const s = Math.floor(fr / fps)
  const f = Math.floor(fr % fps)
  const m = Math.floor(s / 60)
  const ss = s % 60
  const pad = (n:number,l=2)=> String(n).padStart(l,'0')
  return `${pad(m)}:${pad(ss)}:${pad(f)}`
}

async function createVideoThumb(url: string): Promise<string | null> {
  try {
    const v = document.createElement('video')
    v.src = url
    v.crossOrigin = 'anonymous'
    v.preload = 'auto'
    await once(v, 'loadeddata')
    try { v.currentTime = Math.min(0.2, (v.duration || 1) * 0.2) } catch {}
    await once(v, 'seeked')
    const c = document.createElement('canvas')
    const w = v.videoWidth || 320, h = v.videoHeight || 180
    const scale = 160 / Math.max(w, h)
    c.width = Math.max(1, Math.floor(w * scale))
    c.height = Math.max(1, Math.floor(h * scale))
    const ctx = c.getContext('2d')!
    ctx.drawImage(v, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.7)
  } catch { return null }
}

function classify(mime: string): 'video'|'audio'|'sticker' {
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return 'sticker'
}

async function probeDurationFrames(url: string, mime: string, fps: number): Promise<number> {
  try {
    if (mime.startsWith('video/')) {
      const video = document.createElement('video')
      video.src = url
      video.preload = 'metadata'
      await once(video, 'loadedmetadata')
      return Math.max(1, Math.round((video.duration || 5) * fps))
    }
    if (mime.startsWith('audio/')) {
      const audio = document.createElement('audio')
      audio.src = url
      audio.preload = 'metadata'
      await once(audio, 'loadedmetadata')
      return Math.max(1, Math.round((audio.duration || 5) * fps))
    }
    // image / others
    return 3 * fps
  } catch {
    return 5 * fps
  }
}

function once(el: HTMLElement, evt: string) {
  return new Promise<void>((res) => {
    const handler = () => { el.removeEventListener(evt as any, handler as any); res() }
    el.addEventListener(evt as any, handler as any)
  })
}
