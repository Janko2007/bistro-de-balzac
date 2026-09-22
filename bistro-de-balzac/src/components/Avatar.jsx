import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useToast } from '../context/ToastContext'
import { avatarUrl, removeAvatar, uploadAvatar } from '../lib/avatars'
import { cx, errorMessage, initials } from '../lib/utils'
import { Button } from './ui'

/**
 * Krug sa slikom profila — ili inicijalima, dok slike nema.
 * Veličinu i boje daje `className` (npr. "h-11 w-11 text-sm bg-stone-200").
 *
 * `zoomable` — klik na sliku je uveća preko celog ekrana.
 * `onEmptyClick` — šta se radi na klik kad slike NEMA (npr. izbor nove).
 */
export default function Avatar({ name, path, className, zoomable = false, onEmptyClick }) {
  const [url, setUrl] = useState(null)
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    let active = true
    setUrl(null)
    if (path) avatarUrl(path).then((u) => active && setUrl(u))
    return () => {
      active = false
    }
  }, [path])

  const circle = (
    <span
      className={cx(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold',
        className,
      )}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" onError={() => setUrl(null)} />
      ) : (
        initials(name)
      )}
    </span>
  )

  if (zoomable && url) {
    return (
      <>
        <button
          type="button"
          onClick={() => setZoom(true)}
          className="shrink-0 cursor-zoom-in rounded-full"
          aria-label={`Uvećaj sliku — ${name ?? ''}`}
        >
          {circle}
        </button>
        {zoom && <AvatarZoom url={url} name={name} onClose={() => setZoom(false)} />}
      </>
    )
  }

  if (onEmptyClick) {
    return (
      <button type="button" onClick={onEmptyClick} className="shrink-0 rounded-full" aria-label="Dodaj sliku">
        {circle}
      </button>
    )
  }

  return circle
}

/** Uvećana slika preko celog ekrana — zatvara se klikom bilo gde ili tasterom Esc. */
function AvatarZoom({ url, name, onClose }) {
  useEffect(() => {
    // U fazi hvatanja i bez daljeg prosleđivanja — Esc zatvara samo sliku,
    // a ne i prozor „Izmeni radnika“ ispod nje.
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <button
      type="button"
      onClick={onClose}
      className="fixed inset-0 z-50 flex cursor-zoom-out flex-col items-center justify-center gap-4 bg-ink/80 p-6 backdrop-blur-sm"
      aria-label="Zatvori sliku"
    >
      <img
        src={url}
        alt={name ?? ''}
        className="aspect-square w-[min(84vw,420px)] animate-zoom-in rounded-[28px] object-cover shadow-2xl"
      />
      {name && <span className="text-base font-semibold text-white">{name}</span>}
    </button>,
    document.body,
  )
}

/**
 * Slika profila koja može da se menja.
 *   • klik na sliku — uveća je (ako slike nema, otvara izbor fotografije)
 *   • „Dodaj sliku“ / „Promeni sliku“ — nova slika
 *   • „Ukloni“ — vraća inicijale
 *
 * Radnik ovo koristi za sebe (Profil), admin za bilo koga (Radnici → Izmeni).
 * `onChange(novaPutanja | null)` javlja roditelju da osveži podatke.
 */
export function AvatarEditor({ person, className, onChange, children }) {
  const toast = useToast()
  const input = useRef(null)
  const [busy, setBusy] = useState(false)

  const choose = () => input.current?.click()

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // da ista slika može ponovo da se izabere
    if (!file) return

    setBusy(true)
    try {
      const path = await uploadAvatar(person, file)
      toast.success('Slika je sačuvana.')
      onChange?.(path)
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Slika nije sačuvana.'))
    }
    setBusy(false)
  }

  async function remove() {
    setBusy(true)
    try {
      await removeAvatar(person)
      toast.success('Slika je uklonjena.')
      onChange?.(null)
    } catch (err) {
      toast.error(errorMessage(err))
    }
    setBusy(false)
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar
        name={person.full_name}
        path={person.avatar_path}
        className={cx(className, busy && 'opacity-50')}
        zoomable
        onEmptyClick={choose}
      />

      <div className="min-w-0">
        {children}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button variant="secondary" size="sm" loading={busy} onClick={choose}>
            {person.avatar_path ? 'Promeni sliku' : 'Dodaj sliku'}
          </Button>
          {person.avatar_path && (
            <Button
              variant="ghost"
              size="sm"
              className="text-rose-600"
              disabled={busy}
              onClick={remove}
            >
              Ukloni
            </Button>
          )}
        </div>
      </div>

      <input ref={input} type="file" accept="image/*" className="hidden" onChange={pick} />
    </div>
  )
}
