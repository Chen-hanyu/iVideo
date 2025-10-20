const root = document.documentElement

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }

export function setupResizers() {
  const app = document.querySelector('.app') as HTMLElement
  const workspace = document.querySelector('.workspace') as HTMLElement
  if (!app || !workspace) return

  let dragging: null | { type: string } = null

  function onPointerMove(ev: MouseEvent) {
    if (!dragging) return
    ev.preventDefault()
    const appRect = app.getBoundingClientRect()
    const wsRect = workspace.getBoundingClientRect()

    if (dragging.type === 'left') {
      const newW = clamp(ev.clientX - wsRect.left, 160, Math.min(520, wsRect.width - 320))
      root.style.setProperty('--left-width', `${Math.round(newW)}px`)
    } else if (dragging.type === 'right') {
      const newW = clamp(wsRect.right - ev.clientX, 220, Math.min(520, wsRect.width - 220))
      root.style.setProperty('--right-width', `${Math.round(newW)}px`)
    } else if (dragging.type === 'timeline') {
      const newH = clamp(appRect.bottom - ev.clientY, 160, 520)
      root.style.setProperty('--timeline-height', `${Math.round(newH)}px`)
    }
  }

  function onPointerUp() {
    dragging = null
    window.removeEventListener('mousemove', onPointerMove)
    window.removeEventListener('mouseup', onPointerUp)
    ;(document.body as any).style.cursor = ''
  }

  document.querySelectorAll('.resizer').forEach((sash) => {
    sash.addEventListener('mousedown', (ev) => {
      const t = (sash as HTMLElement).dataset.target || ''
      dragging = { type: t }
      window.addEventListener('mousemove', onPointerMove)
      window.addEventListener('mouseup', onPointerUp)
      ;(document.body as any).style.cursor = sash.classList.contains('horizontal') ? 'row-resize' : 'col-resize'
      ev.preventDefault()
    })

    sash.addEventListener('dblclick', () => {
      const target = (sash as HTMLElement).dataset.target
      if (target === 'left') root.style.setProperty('--left-width', '260px')
      if (target === 'right') root.style.setProperty('--right-width', '320px')
      if (target === 'timeline') root.style.setProperty('--timeline-height', '260px')
    })
  })
}

