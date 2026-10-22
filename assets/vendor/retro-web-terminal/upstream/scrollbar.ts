import type { Terminal } from '@xterm/xterm'
import type { ScrollbarOverlay, SourcePlacement } from './effects/pipeline'
import { curvePoint, uncurvePoint } from './effects/math'

/** The shader paints the thumb; this transparent curved path handles input. */
export function createCrtScrollbar(
  root: HTMLElement,
  host: HTMLElement,
  terminal: Terminal,
  onChange: (overlay: ScrollbarOverlay | undefined) => void
) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  const hit = document.createElementNS(ns, 'path')
  svg.classList.add('retro-terminal__scrollbar')
  svg.setAttribute('hidden', '')
  hit.setAttribute('role', 'scrollbar')
  hit.setAttribute('tabindex', '0')
  hit.setAttribute('aria-label', 'Прокрутка истории терминала')
  hit.setAttribute('aria-orientation', 'vertical')
  hit.setAttribute('aria-valuemin', '0')
  if (root.id) hit.setAttribute('aria-controls', root.id)
  svg.append(hit)
  root.append(svg)

  const events = new AbortController()
  const disposables = [
    terminal.onScroll(refresh),
    terminal.onRender(refresh),
    terminal.buffer.onBufferChange(refresh)
  ]
  let enabled = false
  let curvature = 0
  let hovered = false
  let focused = false
  let track: SourcePlacement = { left: 0, top: 0, width: 0, height: 0 }
  let thumb: SourcePlacement = { ...track }
  let drag: { pointer: number; fraction: number } | undefined
  let geometry = ''
  let appearance = ''

  function emit(visible: boolean) {
    const opacity = drag || focused ? 0.56 : hovered ? 0.42 : 0.24
    const key = visible ? `${JSON.stringify(thumb)}:${opacity}` : ''
    if (key === appearance) return
    appearance = key
    onChange(visible ? { ...thumb, opacity } : undefined)
  }

  function release() {
    if (!drag) return
    const pointer = drag.pointer
    drag = undefined
    hit.classList.remove('is-dragging')
    if (hit.hasPointerCapture(pointer)) hit.releasePointerCapture(pointer)
  }

  function refresh() {
    const buffer = terminal.buffer.active
    const nativeTrack = host.querySelector<HTMLElement>('.scrollbar.vertical')
    const outer = root.getBoundingClientRect()
    const rect = nativeTrack?.getBoundingClientRect()
    const visible = enabled && buffer.type === 'normal' && buffer.baseY > 0
      && Boolean(rect?.width && rect.height && outer.width && outer.height)
    svg.toggleAttribute('hidden', !visible)
    if (!visible || !rect) {
      release()
      if (focused) terminal.focus()
      emit(false)
      return
    }
    track = {
      left: rect.left - outer.left,
      top: rect.top - outer.top,
      width: rect.width,
      height: rect.height
    }
    const height = Math.min(track.height, Math.max(24,
      track.height * terminal.rows / (terminal.rows + buffer.baseY)))
    thumb = {
      ...track,
      top: track.top + (track.height - height) * buffer.viewportY / buffer.baseY,
      height
    }
    hit.setAttribute('aria-valuemax', String(buffer.baseY))
    hit.setAttribute('aria-valuenow', String(buffer.viewportY))
    const nextGeometry = `${JSON.stringify(track)}:${outer.width}:${outer.height}:${curvature}`
    if (geometry !== nextGeometry) {
      geometry = nextGeometry
      svg.setAttribute('viewBox', `0 0 ${outer.width} ${outer.height}`)
      const corners = [
        [track.left, track.top],
        [track.left + track.width, track.top],
        [track.left + track.width, track.top + track.height],
        [track.left, track.top + track.height]
      ]
      const points: string[] = []
      for (let edge = 0; edge < 4; edge++) {
        const a = corners[edge]!
        const b = corners[(edge + 1) % 4]!
        for (let step = 0; step < 32; step++) {
          const t = step / 32
          const p = uncurvePoint(
            (a[0]! + (b[0]! - a[0]!) * t) / outer.width,
            (a[1]! + (b[1]! - a[1]!) * t) / outer.height,
            curvature
          )
          points.push(`${p.x * outer.width},${p.y * outer.height}`)
        }
      }
      hit.setAttribute('d', `M${points.join(' L')} Z`)
    }
    emit(true)
  }

  function sourceY(event: PointerEvent) {
    const rect = root.getBoundingClientRect()
    return curvePoint(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
      curvature
    ).y * rect.height
  }

  function scroll(y: number, fraction: number) {
    const range = track.height - thumb.height
    if (range <= 0) return
    const progress = (y - track.top - fraction * thumb.height) / range
    terminal.scrollToLine(Math.round(Math.max(0, Math.min(1, progress))
      * terminal.buffer.active.baseY))
    refresh()
  }

  const options = { signal: events.signal }
  hit.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return
    event.preventDefault()
    event.stopPropagation()
    const y = sourceY(event)
    const fraction = y >= thumb.top && y <= thumb.top + thumb.height
      ? (y - thumb.top) / thumb.height : 0.5
    drag = { pointer: event.pointerId, fraction }
    hit.setPointerCapture(event.pointerId)
    hit.classList.add('is-dragging')
    terminal.focus()
    scroll(y, fraction)
  }, options)
  hit.addEventListener('pointermove', event => {
    if (drag?.pointer !== event.pointerId) return
    event.preventDefault()
    scroll(sourceY(event), drag.fraction)
  }, options)
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    hit.addEventListener(name, () => {
      release()
      refresh()
    }, options)
  }
  hit.addEventListener('pointerenter', () => { hovered = true; refresh() }, options)
  hit.addEventListener('pointerleave', () => { hovered = false; refresh() }, options)
  hit.addEventListener('focus', () => { focused = true; refresh() }, options)
  hit.addEventListener('blur', () => { focused = false; refresh() }, options)
  hit.addEventListener('keydown', event => {
    const current = terminal.buffer.active.viewportY
    const positions: Record<string, number> = {
      ArrowUp: current - 1, ArrowDown: current + 1,
      PageUp: current - terminal.rows, PageDown: current + terminal.rows,
      Home: 0, End: terminal.buffer.active.baseY
    }
    if (event.key === 'Escape') terminal.focus()
    else if (event.key in positions) terminal.scrollToLine(Math.max(0,
      Math.min(terminal.buffer.active.baseY, positions[event.key]!)))
    else return
    event.preventDefault()
    event.stopPropagation()
  }, options)
  hit.addEventListener('wheel', event => {
    if (!event.deltaY || event.ctrlKey) return
    const pixels = event.deltaY * (event.deltaMode === 1
      ? track.height / terminal.rows : event.deltaMode === 2 ? track.height : 1)
    terminal.scrollLines(Math.sign(pixels) * Math.max(1,
      Math.round(Math.abs(pixels) / (track.height / terminal.rows))))
    event.preventDefault()
    event.stopPropagation()
  }, { ...options, passive: false })

  return {
    update(nextEnabled: boolean, nextCurvature: number) {
      enabled = nextEnabled
      curvature = nextCurvature
      root.toggleAttribute('data-crt-scrollbar', enabled)
      refresh()
    },
    dispose() {
      events.abort()
      release()
      for (const disposable of disposables) disposable.dispose()
      svg.remove()
      root.removeAttribute('data-crt-scrollbar')
    }
  }
}
