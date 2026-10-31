import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { renderScheduleCanvas } from '../lib/scheduleImage'
import { Button } from './ui'

const MIN_ZOOM = 1
const MAX_ZOOM = 5

/**
 * Raspored kao slika. Cela slika se vidi odmah, bez povlačenja u stranu;
 * klik otvara veći prikaz preko celog ekrana, gde može da se uveća, pomera i
 * preuzme.
 */
export default function ScheduleImage({
  week,
  slots,
  names,
  cyr = false,
  meId = null,
  blank = false,
  onDownload = null,
  downloading = false,
}) {
  const [src, setSrc] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let active = true
    const timer = setTimeout(async () => {
      try {
        let canvas = await renderScheduleCanvas({ week, slots, names, cyr, meId, blank })
        let url
        try {
          url = canvas.toDataURL('image/png')
        } catch {
          // Pregledač ne dozvoli izvoz slike sa logom — crta se bez njega.
          canvas = await renderScheduleCanvas({ week, slots, names, cyr, meId, blank, logo: false })
          url = canvas.toDataURL('image/png')
        }
        if (active) setSrc(url)
      } catch (err) {
        console.error(err)
      }
    }, 120)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [week, slots, names, cyr, meId, blank])

  return (
    <div className="space-y-2.5">
      <button
        type="button"
        onClick={() => src && setOpen(true)}
        aria-label="Otvori veću sliku rasporeda"
        className="block w-full overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-stone-200 transition hover:ring-stone-300"
      >
        {src ? (
          <img src={src} alt="Raspored smena" className="block h-auto w-full cursor-zoom-in" draggable="false" />
        ) : (
          <div className="h-32 animate-pulse bg-stone-100" />
        )}
      </button>

      <div className="flex gap-2">
        <Button variant="secondary" size="sm" className="flex-1" disabled={!src} onClick={() => setOpen(true)}>
          Uvećaj
        </Button>
        {onDownload && (
          <Button variant="secondary" size="sm" className="flex-1" loading={downloading} onClick={onDownload}>
            Preuzmi sliku
          </Button>
        )}
      </div>

      {open && src && (
        <Viewer src={src} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Veliki prikaz: raspored na sredini ekrana, samo × za zatvaranje.     */
/*  Uvećava se dvaput dodirnutim ili štipanjem, a pomera povlačenjem.    */
/* ------------------------------------------------------------------ */
function Viewer({ src, onClose }) {
  const [zoom, setZoom] = useState(1)
  const box = useRef(null)
  const pinch = useRef(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const clamp = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

  /** Menja uvećanje tako da tačka pod prstom ostane na istom mestu. */
  function zoomTo(next, clientX, clientY) {
    const el = box.current
    const z = clamp(next)
    if (!el || z === zoom) return setZoom(z)
    const rect = el.getBoundingClientRect()
    const px = (clientX ?? rect.left + rect.width / 2) - rect.left
    const py = (clientY ?? rect.top + rect.height / 2) - rect.top
    const ratio = z / zoom
    const left = (el.scrollLeft + px) * ratio - px
    const top = (el.scrollTop + py) * ratio - py
    setZoom(z)
    requestAnimationFrame(() => {
      el.scrollLeft = left
      el.scrollTop = top
    })
  }

  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

  function onTouchStart(e) {
    if (e.touches.length === 2) pinch.current = { d: dist(e.touches), z: zoom }
  }
  function onTouchMove(e) {
    if (e.touches.length === 2 && pinch.current) {
      e.preventDefault()
      zoomTo(
        pinch.current.z * (dist(e.touches) / pinch.current.d),
        (e.touches[0].clientX + e.touches[1].clientX) / 2,
        (e.touches[0].clientY + e.touches[1].clientY) / 2,
      )
    }
  }
  const onTouchEnd = () => {
    pinch.current = null
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-ink/90" role="dialog" aria-modal="true" aria-label="Raspored">
      <button
        type="button"
        onClick={onClose}
        aria-label="Zatvori"
        className="fixed right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white text-stone-900 shadow-lg ring-1 ring-black/10 transition active:scale-95 hover:bg-stone-100"
        style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.75"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      {/* m-auto na slici: kad je manja od ekrana stoji na sredini, kad je uvećana — pomera se */}
      <div
        ref={box}
        className="flex h-full w-full overflow-auto p-3"
        style={{ touchAction: zoom > 1 ? 'pan-x pan-y' : 'pan-y' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <img
          src={src}
          alt="Raspored smena"
          draggable="false"
          onDoubleClick={(e) => zoomTo(zoom > 1 ? 1 : 2.5, e.clientX, e.clientY)}
          className="m-auto block h-auto max-w-none shrink-0 select-none rounded-xl bg-white shadow-2xl"
          style={{ width: `${zoom * 100}%` }}
        />
      </div>
    </div>,
    document.body,
  )
}