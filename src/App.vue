<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">iVideo</div>
      <div class="project-info">{{ pj.name }}</div>
      <div class="actions">
        <button class="btn" title="项目管理" @click="onProjectManager">项目管理</button>
        <button class="btn primary" title="导出视频" @click="onExport">导出</button>
      </div>
    </header>

    <section class="workspace">
      <aside class="sidebar-left">
        <div class="left-layout">
          <nav class="dock" aria-label="工具">
            <button class="tool active" title="视频" data-cat="video">视频</button>
            <button class="tool" title="音频" data-cat="audio">音频</button>
            <button class="tool" title="文本" data-cat="text">文本</button>
            <button class="tool" title="贴图" data-cat="sticker">贴图</button>
          </nav>
          <div class="asset-list">
            <div class="assets-header">
              <h4 class="assets-title">用户上传（视频）</h4>
              <div>
                <button class="btn" id="btnUpload">上传</button>
                <input id="fileInput" type="file" accept="video/*" multiple hidden />
              </div>
            </div>
            <!-- Video assets -->
            <div class="assets assets-category active" id="assetsVideo"></div>
            <!-- Audio assets -->
            <div class="assets-header small"><h4 class="assets-title">用户上传（音频）</h4></div>
            <div class="assets assets-category" id="assetsAudio"></div>
            <!-- Text assets -->
            <div class="assets-header small"><h4 class="assets-title">用户上传（文本）</h4></div>
            <div class="assets assets-category" id="assetsText"></div>
            <!-- Sticker assets -->
            <div class="assets-header small"><h4 class="assets-title">用户上传（贴图）</h4></div>
            <div class="assets assets-category" id="assetsSticker"></div>
            
          </div>
        </div>
      </aside>

      <div class="resizer vertical" data-direction="vertical" data-target="left" title="拖拽调整左侧宽度"></div>

      <main class="preview-area">
        <div class="player">
          <div class="stage">
            <div class="stage-content">
              <canvas id="previewCanvas"></canvas>
              <div id="overlayLayer" class="overlay-layer"></div>
              <div class="placeholder">预览区</div>
            </div>
          </div>
          <div class="player-controls">
            <div class="time" id="timeLabel">00:00:00 / 00:00:10</div>
            <div class="controls">
              <button class="btn" id="btnPrev" title="上一帧">⏮</button>
              <button class="btn" id="btnPlay" title="播放/暂停">▶</button>
              <button class="btn" id="btnNext" title="下一帧">⏭</button>
            </div>
          </div>
        </div>
      </main>

      <div class="resizer vertical" data-direction="vertical" data-target="right" title="拖拽调整右侧宽度"></div>

      <aside class="sidebar-right">
        <div class="panel-tabs">
          <button class="tab active">属性</button>
        </div>
        <PropertiesPanel />
      </aside>
    </section>

    <div class="resizer horizontal" data-direction="horizontal" data-target="timeline" title="拖拽调整时间轴高度"></div>

    <Timeline />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Timeline from './components/Timeline/Timeline.vue'
import PropertiesPanel from './components/Panels/PropertiesPanel.vue'
import { setupResizers } from './core/resizer'
import { setupAssetsUI } from './core/assets'
import { setupPreview } from './core/preview'
import { saveLocal, loadLocal, exportVideo } from './core/serialization'
import { useProjectStore } from './store/project'

const pj = useProjectStore()

onMounted(() => {
  setupResizers()
  setupAssetsUI()
  setupPreview()
  // 资源重连：监听无效媒体提示，弹出文件选择器重绑
  window.addEventListener('ivideo-media-invalid' as any, (e:any)=>{
    const { src, id } = (e as any).detail||{}
    if (!src || !id) return
    const panel = document.createElement('div')
    panel.style.position='fixed'; panel.style.inset='0'; panel.style.display='grid'; panel.style.placeItems='center'; panel.style.background='rgba(0,0,0,0.45)'; panel.style.zIndex='1000'
    panel.innerHTML = `<div style="background:#111827;border:1px solid #263445;border-radius:10px;padding:14px 16px;min-width:360px;box-shadow:0 10px 30px rgba(0,0,0,.35);"><div style="color:#cbd5e1;font-weight:600;margin-bottom:10px;">资源需要重连</div><div style="display:grid;gap:10px;"><div style="color:#94a3b8">原路径不可用：${src}</div><input id="rebind-file" type="file" accept="video/*,audio/*,image/*" style="background:#0b1118;border:1px solid #2b3a4d;border-radius:6px;color:#fff;padding:8px" /><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="rebind-cancel" class="btn ghost">取消</button><button id="rebind-ok" class="btn primary">绑定</button></div></div></div>`
    document.body.appendChild(panel)
    ;(panel.querySelector('#rebind-cancel') as HTMLButtonElement).onclick = ()=> panel.remove()
    ;(panel.querySelector('#rebind-ok') as HTMLButtonElement).onclick = ()=>{
      const fin = panel.querySelector('#rebind-file') as HTMLInputElement
      const f = fin?.files?.[0]
      if (!f) { panel.remove(); return }
      const url = URL.createObjectURL(f)
      const ev = new CustomEvent('ivideo-update-clip', { detail: { id, key:'source', value:url } })
      window.dispatchEvent(ev)
      panel.remove()
    }
  })
})

function showPrompt(html: string, onOk: (value: string)=>void){
  const panel = document.createElement('div')
  panel.style.position='fixed'; panel.style.inset='0'; panel.style.display='grid'; panel.style.placeItems='center'; panel.style.background='rgba(0,0,0,0.45)'
  panel.innerHTML = html
  document.body.appendChild(panel)
  ;(panel.querySelector('.btn-cancel') as HTMLButtonElement).onclick = ()=> panel.remove()
  ;(panel.querySelector('.btn-ok') as HTMLButtonElement).onclick = ()=>{
    const field = (panel.querySelector('input, select') as HTMLInputElement|null)
    const val = field ? field.value : ''
    onOk(val.trim())
    panel.remove()
  }
}

function onSave(){
  showPrompt(`<div style="background:#111827;border:1px solid #263445;border-radius:10px;padding:14px 16px;min-width:320px;box-shadow:0 10px 30px rgba(0,0,0,.35);">
    <div style="color:#cbd5e1;font-weight:600;margin-bottom:10px;">保存项目</div>
    <div style="display:grid;gap:10px;">
      <input placeholder="项目名称" value="${pj.name||'我的项目'}" style="background:#0b1118;border:1px solid #2b3a4d;border-radius:6px;color:#fff;padding:8px" />
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn ghost btn-cancel">取消</button>
        <button class="btn primary btn-ok">确定</button>
      </div>
    </div>
  </div>`, (val)=>{ if(val) pj.setName(val); saveLocal(val); })
}

function onLoad(){
  // 收集所有保存的项目名
  const keys = Object.keys(localStorage).filter(k=>k.startsWith('ivideo_project_'))
  const names = keys.map(k=>k.replace('ivideo_project_',''))
  const options = names.map(n=>`<option value="${n}">${n}</option>`).join('')
  showPrompt(`<div style="background:#111827;border:1px solid #263445;border-radius:10px;padding:14px 16px;min-width:360px;box-shadow:0 10px 30px rgba(0,0,0,.35);">
    <div style="color:#cbd5e1;font-weight:600;margin-bottom:10px;">加载项目</div>
    <div style="display:grid;gap:10px;">
      <select style="background:#0b1118;border:1px solid #2b3a4d;border-radius:6px;color:#fff;padding:8px">${options}</select>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn ghost btn-cancel">取消</button>
        <button class="btn primary btn-ok">确定</button>
      </div>
    </div>
  </div>`, (val)=>{
    const data = loadLocal(val)
  if(!data) return
  pj.setFrom(data)
  window.dispatchEvent(new Event('ivideo-rebuild'))
    // 加载后检查是否存在 blob: 资源需要重连
    requestAnimationFrame(()=> promptRelinkSourcesAfterLoad())
  })
}

function onExport(){
  // 导出设置弹窗：仅清晰度
  const html = `<div style="background:#111827;border:1px solid #263445;border-radius:10px;padding:14px 16px;min-width:360px;box-shadow:0 10px 30px rgba(0,0,0,.35);">
    <div style=\"color:#cbd5e1;font-weight:600;margin-bottom:10px;\">导出视频</div>
    <div style=\"display:grid;gap:10px;\">
      <label style=\"color:#94a3b8\">清晰度</label>
      <select id=\"exp-res\" style=\"background:#0b1118;border:1px solid #2b3a4d;border-radius:6px;color:#fff;padding:8px\">
        <option value=\"1280x720\">720p (1280x720)</option>
        <option value=\"1920x1080\">1080p (1920x1080)</option>
        <option value=\"custom\">自定义</option>
      </select>
      <div id=\"exp-custom\" style=\"display:none;grid-template-columns:1fr 1fr;gap:8px;\">
        <input id=\"cw\" placeholder=\"宽\" type=\"number\" min=\"320\" value=\"1280\" style=\"background:#0b1118;border:1px solid #2b3a4d;border-radius:6px;color:#fff;padding:8px\" />
        <input id=\"ch\" placeholder=\"高\" type=\"number\" min=\"240\" value=\"720\" style=\"background:#0b1118;border:1px solid #2b3a4d;border-radius:6px;color:#fff;padding:8px\" />
      </div>
      <div style=\"display:flex;gap:8px;justify-content:flex-end;\">
        <button class=\"btn ghost btn-cancel\">取消</button>
        <button class=\"btn primary btn-ok\">开始导出</button>
      </div>
    </div>
  </div>`
  showPrompt(html, async ()=>{
    const resSel = document.querySelector('#exp-res') as HTMLSelectElement
    const res = resSel.value
    let w=0,h=0
    if (res==='custom'){
      const cw = document.querySelector('#cw') as HTMLInputElement
      const ch = document.querySelector('#ch') as HTMLInputElement
      w = Math.max(320, Number(cw.value||'1280'))
      h = Math.max(240, Number(ch.value||'720'))
    } else {
      const [rw,rh] = res.split('x').map(Number); w=rw; h=rh
    }
    const { exportVideoFullProject } = await import('./core/serialization')
    // 新开“进度”弹窗
    const panel = document.createElement('div')
    panel.style.position='fixed'; panel.style.inset='0'; panel.style.display='grid'; panel.style.placeItems='center'; panel.style.background='rgba(0,0,0,0.45)'; panel.style.zIndex='1000'
    panel.innerHTML = `
      <div style="background:#111827;border:1px solid #263445;border-radius:10px;padding:14px 16px;min-width:360px;box-shadow:0 10px 30px rgba(0,0,0,.35);">
        <div style="color:#cbd5e1;font-weight:600;margin-bottom:10px;">导出中…</div>
        <div style="display:grid;gap:10px;">
          <label style="color:#94a3b8">进度</label>
          <div style="height:8px;background:#0b1118;border:1px solid #2b3a4d;border-radius:999px;overflow:hidden;">
            <div id="exp-progress" style="height:100%;width:0%;background:#3b82f6;transition:width .1s linear;"></div>
          </div>
          <div id="exp-percent" style="color:#94a3b8;font-size:12px;text-align:right;margin-top:4px;">0%</div>
          <div style="display:flex;justify-content:flex-end;">
            <button id="exp-cancel" class="btn ghost">关闭</button>
          </div>
        </div>
      </div>`
    document.body.appendChild(panel)
    const bar = panel.querySelector('#exp-progress') as HTMLElement
    const num = panel.querySelector('#exp-percent') as HTMLElement
    ;(panel.querySelector('#exp-cancel') as HTMLButtonElement).onclick = ()=> panel.remove()
    const onProg = (e:any)=>{ const p = Math.max(0, Math.min(100, Number((e.detail||{}).percent||0))); if (bar) bar.style.width = p + '%'; if (num) num.textContent = p + '%' }
    const onDone = ()=>{ window.removeEventListener('ivideo-export-progress' as any, onProg); setTimeout(()=> panel.remove(), 400) }
    window.addEventListener('ivideo-export-progress' as any, onProg)
    window.addEventListener('ivideo-export-complete' as any, onDone, { once:true })
    exportVideoFullProject({ width:w, height:h, fps:30 })
  })
}

function onProjectManager(){
  // 构建列表
  const keys = Object.keys(localStorage).filter(k=>k.startsWith('ivideo_project_'))
  const names = keys.map(k=>k.replace('ivideo_project_',''))
  const rows = names.map(n=>`<div class=\"pm-row\" data-name=\"${n}\" style=\"display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;\"><span>${n}</span><button class=\"btn\" data-act=\"open\">打开</button><button class=\"btn\" data-act=\"rename\">重命名</button><button class=\"btn\" data-act=\"delete\">删除</button></div>`).join('')
  const panel = document.createElement('div')
  panel.style.position='fixed'; panel.style.inset='0'; panel.style.display='grid'; panel.style.placeItems='center'; panel.style.background='rgba(0,0,0,0.45)'
  panel.innerHTML = `
    <div style="background:#111827;border:1px solid #263445;border-radius:10px;padding:14px 16px;min-width:420px;box-shadow:0 10px 30px rgba(0,0,0,.35);">
      <div style="color:#cbd5e1;font-weight:600;margin-bottom:10px;">项目管理</div>
      <div id="pm-body" style="display:grid;gap:8px;max-height:50vh;overflow:auto;">
        ${rows || '<div style="color:#94a3b8">暂无项目</div>'}
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
        <button class="btn ghost" id="pm-close">关闭</button>
        <button class="btn primary" id="pm-save">保存(覆盖)</button>
      </div>
    </div>`
  document.body.appendChild(panel)
  const body = panel.querySelector('#pm-body') as HTMLElement
  const btnClose = panel.querySelector('#pm-close') as HTMLButtonElement
  const btnSave = panel.querySelector('#pm-save') as HTMLButtonElement
  btnClose.onclick = ()=> panel.remove()
  btnSave.onclick = ()=>{
    const name = pj.name || ''
    const exists = !!localStorage.getItem('ivideo_project_'+name)
    if (!name || name==='未命名项目' || !exists){
      // 首次保存：命名
      const promptPanel = document.createElement('div')
      promptPanel.style.position='fixed'; promptPanel.style.inset='0'; promptPanel.style.display='grid'; promptPanel.style.placeItems='center'; promptPanel.style.background='rgba(0,0,0,0.45)'; promptPanel.style.zIndex='1001'
      promptPanel.innerHTML = `<div style=\"background:#111827;border:1px solid #263445;border-radius:10px;padding:14px 16px;min-width:320px;box-shadow:0 10px 30px rgba(0,0,0,.35);\"><div style=\"color:#cbd5e1;font-weight:600;margin-bottom:10px;\">命名项目</div><div style=\"display:grid;gap:10px;\"><input id=\"nm\" placeholder=\"项目名称\" value=\"${name && name!=='未命名项目'?name:'我的项目'}\" style=\"background:#0b1118;border:1px solid #2b3a4d;border-radius:6px;color:#fff;padding:8px\" /><div style=\"display:flex;gap:8px;justify-content:flex-end;\"><button id=\"c\" class=\"btn ghost\">取消</button><button id=\"o\" class=\"btn primary\">保存</button></div></div></div>`
      document.body.appendChild(promptPanel)
      ;(promptPanel.querySelector('#c') as HTMLButtonElement).onclick = ()=> promptPanel.remove()
      ;(promptPanel.querySelector('#o') as HTMLButtonElement).onclick = ()=>{
        const nm = String((promptPanel.querySelector('#nm') as HTMLInputElement).value||'我的项目')
        pj.setName(nm); saveLocal(nm); alert('已保存为：'+nm); promptPanel.remove(); panel.remove()
      }
    } else {
      // 直接覆盖
      saveLocal(name); alert('已覆盖保存为：'+name); panel.remove()
    }
  }
  body?.addEventListener('click', (e)=>{
    const target = e.target as HTMLElement
    const row = target.closest('.pm-row') as HTMLElement|null
    if (!row) return
    const act = target.getAttribute('data-act')
    const name = row.getAttribute('data-name')||''
    if (act==='open'){
      const data = loadLocal(name); if(!data) return; pj.setFrom(data); window.dispatchEvent(new Event('ivideo-rebuild')); panel.remove()
    } else if (act==='rename'){
      const nn = prompt('重命名为：', name)||''
      if (nn && nn!==name){ const json = localStorage.getItem('ivideo_project_'+name); if(json){ localStorage.setItem('ivideo_project_'+nn, json); localStorage.removeItem('ivideo_project_'+name); pj.setName(nn); (row.querySelector('span') as HTMLElement).textContent = nn; row.setAttribute('data-name', nn) } }
    } else if (act==='delete'){
      if (confirm('删除项目 '+name+' ?')){ localStorage.removeItem('ivideo_project_'+name); row.remove() }
    }
  })
}

function promptRelinkSourcesAfterLoad(){
  const need: Array<{key:string,label:string,type:string}> = []
  const seen = new Set<string>()
  const tracks = (pj as any).tracks || []
  for (const t of tracks){
    for (const c of (t.clips||[])){
      const src = String((c.data&&c.data.source)||c.source||'')
      if (!src) continue
      if (src.startsWith('blob:') && !seen.has(src)){
        seen.add(src)
        need.push({ key: src, label: c.label||src.split('/').pop()||c.type, type: c.type })
      }
    }
  }
  if (!need.length) return
  const rows = need.map(n=>`<div class=\"row\" data-key=\"${n.key}\" style=\"display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;\"><div style=\"color:#cbd5e1\">${n.label}</div><button class=\"btn\" data-act=\"pick\">选择文件</button></div>`).join('')
  const panel = document.createElement('div')
  panel.style.position='fixed'; panel.style.inset='0'; panel.style.display='grid'; panel.style.placeItems='center'; panel.style.background='rgba(0,0,0,0.45)'; panel.style.zIndex='1000'
  panel.innerHTML = `<div style=\"background:#111827;border:1px solid #263445;border-radius:10px;padding:14px 16px;min-width:420px;box-shadow:0 10px 30px rgba(0,0,0,.35);\"><div style=\"color:#cbd5e1;font-weight:600;margin-bottom:10px;\">资源需要重连</div><div id=\"rb-body\" style=\"display:grid;gap:10px;max-height:50vh;overflow:auto;\">${rows}</div><div style=\"display:flex;gap:8px;justify-content:flex-end;margin-top:10px;\"><button id=\"rb-close\" class=\"btn ghost\">关闭</button></div></div>`
  document.body.appendChild(panel)
  ;(panel.querySelector('#rb-close') as HTMLButtonElement).onclick = ()=> panel.remove()
  const body = panel.querySelector('#rb-body') as HTMLElement
  body?.addEventListener('click', (e)=>{
    const btn = (e.target as HTMLElement).closest('[data-act=pick]') as HTMLElement|null
    if (!btn) return
    const row = btn.closest('.row') as HTMLElement
    const key = row.getAttribute('data-key')||''
    const input = document.createElement('input'); input.type='file'; input.accept='video/*,audio/*,image/*'; input.onchange = ()=>{
      const f = input.files?.[0]; if(!f) return
      const url = URL.createObjectURL(f)
      // 替换所有引用该源的片段
      (pj as any).tracks.forEach((t:any)=> t.clips.forEach((c:any)=>{
        const src = String((c.data&&c.data.source)||c.source||'')
        if (src===key){ if (!c.data) c.data={}; c.data.source=url; const ev = new CustomEvent('ivideo-update-clip',{ detail:{ id:c.id, key:'source', value:url } }); window.dispatchEvent(ev) }
      }))
      row.remove()
      window.dispatchEvent(new Event('ivideo-rebuild'))
    }
    input.click()
  })
}
</script>

<style scoped>
/* 在此可放组件局部样式；全局样式来自 src/styles.css */
</style>
