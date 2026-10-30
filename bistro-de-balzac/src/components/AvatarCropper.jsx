import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Button, Modal } from './ui'

const PREVIEW = 280 // stranica prikaza na ekranu (px)
const OUTPUT = 640 // stranica slike koja se čuva (px)

/** Učitava fotografiju (sa ispravnom rotacijom sa telefona). */
function loadImage(file) {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file))
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = reject
    img.src = url
  })
}

/**
 * Crta sliku u kvadrat stranice `size`. `zoom` ≥ 1 (1 = slika tek pokriva
 * kvadrat), `off` je pomeraj kao deo stranice. Pomeraj se ograničava tako da
 * nikad ne ostane prazan prostor.
 */
function draw(ctx, img, size, zoom, off) {
  const w = img.width
  const h = img.height
  const scale = Math.max(size / w, size / h) * zoom
  const dw = w * scale
  const dh = h * scale
  const maxX = (dw - size) / 2
  const maxY = (dh - size) / 2
  const ox = Math.max(-maxX, Math.min(maxX, off.x * size))
  const oy = Math.max(-maxY, Math.min(maxY, off.y * size))
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(img, size / 2 - dw / 2 + ox, size / 2 - dh / 2 + oy, dw, dh)
  return { maxX: maxX / size, maxY: maxY / size }
}

/**
 * Pomeranje i zumiranje slike profila pre čuvanja. Prstom (ili mišem) se
 * slika povlači unutar kruga, a klizač je uvećava. „Sačuvaj“ vraća gotov
 * kvadrat 640×640.
 */
export default function AvatarCropper({ file, onCancel, onDone }) {
  const canvas = useRef(null)
  const image = useRef(null)
  const drag = useRef(null)
  const [ready, setReady] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setReady(false)
    setFailed(false)
    setZoom(1)
    setOff({ x: 0, y: 0 })
    if (!file) return undefined
    loadImage(file)
      .then((img) => {
        if (!active) return
        image.current = img
        setReady(true)
      })
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [file])

  const paint = useCallback(() => {
    const el = canvas.current
    if (!el || !image.current) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    el.width = PREVIEW * dpr
    el.height = PREVIEW * dpr
    const ctx = el.getContext('2d')
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    draw(ctx, image.current, PREVIEW * dpr, zoom, off)
  }, [zoom, off])

  useEffect(() => {
    if (ready) paint()
  }, [ready, paint])

  function clampOff(next, z) {
    const img = image.current
    const scale = Math.max(1 / img.width, 1 / img.height) * z
    const maxX = Math.max(0, (img.width * scale - 1) / 2)
    const maxY = Math.max(0, (img.height * scale - 1) / 2)
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    }
  }

  function onDown(e) {
    if (!ready) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, start: off }
  }

  function onMove(e) {
    const d = drag.current
    if (!d) return
    const next = {
      x: d.start.x + (e.clientX - d.x) / PREVIEW,
      y: d.start.y + (e.clientY - d.y) / PREVIEW,
    }
    setOff(clampOff(next, zoom))
  }

  function onUp() {
    drag.current = null
  }

  function onZoom(value) {
    const z = Number(value)
    setZoom(z)
    setOff((prev) => clampOff(prev, z))
  }

  async function save() {
    if (!image.current) return
    setBusy(true)
    try {
      const out = document.createElement('canvas')
      out.width = OUTPUT
      out.height = OUTPUT
      draw(out.getContext('2d'), image.current, OUTPUT, zoom, off)
      const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.85))
      if (!blob) throw new Error('Ne mogu da obradim sliku.')
      await onDone(new File([blob], 'avatar.jpg', { type: 'image/jpeg', lastModified: Date.now() }))
    } finally {
      setBusy(false)
    }
  }

  // Prozor ide na vrh stranice, da radi i kad je otvoren iz drugog prozora.
  return createPortal(
    <Modal
      open={Boolean(file)}
      onClose={() => !busy && onCancel()}
      title="Namesti sliku"
      size="sm"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={onCancel}>
            Otkaži
          </Button>
          <Button className="flex-1" loading={busy} disabled={!ready} onClick={save}>
            Sačuvaj
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-4">
        {failed ? (
          <p className="text-sm text-rose-600">Ne mogu da otvorim ovu sliku.</p>
        ) : (
          <>
            <div
              className="relative touch-none select-none overflow-hidden rounded-2xl bg-stone-100"
              style={{ width: PREVIEW, height: PREVIEW }}
            >
              <canvas
                ref={canvas}
                style={{ width: PREVIEW, height: PREVIEW }}
                className="block cursor-grab active:cursor-grabbing"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              />
              {/* Krug pokazuje šta ostaje na profilu; van kruga je zatamnjeno. */}
              <div
                className="pointer-events-none absolute inset-0 rounded-full"
                style={{ boxShadow: '0 0 0 400px rgba(28,25,23,.45)' }}
              />
              <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/80" />
            </div>

            <label className="flex w-full items-center gap-3 text-xs font-semibold text-stone-500">
              <span aria-hidden="true">−</span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={zoom}
                onChange={(e) => onZoom(e.target.value)}
                disabled={!ready}
                aria-label="Uvećanje"
                className="h-2 flex-1 accent-brand-600"
              />
              <span aria-hidden="true">+</span>
            </label>
            <p className="text-[12px] text-stone-400">Povuci sliku da je centriraš.</p>
          </>
        )}
      </div>
    </Modal>,
    document.body,
  )
}
