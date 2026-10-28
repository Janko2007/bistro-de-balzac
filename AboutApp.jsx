import { useState } from 'react'

import { ABOUT } from '../lib/about'
import { cx } from '../lib/utils'
import { Card } from './ui'

const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''

/** Dugme-link: otvara spoljnu adresu u novom prozoru. */
function LinkButton({ href, icon, label, sub }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-2xl bg-stone-100 px-4 py-3 text-left transition hover:bg-stone-200/70 active:scale-[.99]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-stone-700 ring-1 ring-inset ring-stone-200">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-stone-900">{label}</span>
        {sub && <span className="block truncate text-[12px] text-stone-500">{sub}</span>}
      </span>
      <svg
        className="h-4 w-4 shrink-0 text-stone-300"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M7 17L17 7M9 7h8v8" />
      </svg>
    </a>
  )
}

const InstagramIcon = (
  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.2" cy="6.8" r="0.8" fill="currentColor" stroke="none" />
  </svg>
)

const GlobeIcon = (
  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
  </svg>
)

/** „https://www.instagram.com/neko/“ → „@neko“ */
function handleOf(url) {
  const m = /instagram\.com\/([^/?#]+)/i.exec(url)
  return m ? `@${m[1]}` : url
}

/** „https://emjay.rs/“ → „emjay.rs“ */
function hostOf(url) {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')
}

/**
 * O aplikaciji — na dnu Profila, ispod Pravila i obaveza.
 * Zatvoreno dok se ne klikne; otvoreno pokazuje logo, Instagram i sajt.
 */
export default function AboutApp() {
  const [open, setOpen] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cx(
          'flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition',
          open ? 'bg-stone-100' : 'hover:bg-stone-50',
        )}
      >
        <svg
          className={cx('h-4 w-4 shrink-0 text-stone-400 transition-transform', open && 'rotate-90')}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span className="min-w-0 flex-1 text-base font-extrabold tracking-tight text-stone-900">
          O aplikaciji
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-stone-100 px-4 pb-5 pt-6">
          {/* Logo */}
          <div className="flex flex-col items-center text-center">
            {ABOUT.logo && !logoFailed ? (
              <img
                src={ABOUT.logo}
                alt={ABOUT.name}
                onError={() => setLogoFailed(true)}
                className="max-h-24 max-w-[220px] object-contain mix-blend-multiply"
              />
            ) : (
              /* Logo nacrtan kodom: tirkizni polukrug + „emjay“. Koristi se dok
                 slika public/emjay-logo.png ne postoji. */
              <div
                className="flex items-end gap-3 py-2"
                role="img"
                aria-label={ABOUT.name}
              >
                <span
                  aria-hidden="true"
                  className="block h-[30px] w-[60px] shrink-0 bg-[#3ec4b4]"
                  style={{ borderRadius: '60px 60px 0 0' }}
                />
                <span
                  aria-hidden="true"
                  className="text-[44px] font-extrabold leading-[0.78] tracking-[-0.04em] text-[#0b0f12]"
                >
                  {ABOUT.name.toLowerCase()}
                </span>
              </div>
            )}
            {ABOUT.tagline && <p className="mt-1 text-sm text-stone-500">{ABOUT.tagline}</p>}
          </div>

          {(ABOUT.instagram || ABOUT.website) && (
            <div className="space-y-2">
              {ABOUT.instagram && (
                <LinkButton
                  href={ABOUT.instagram}
                  icon={InstagramIcon}
                  label="Instagram"
                  sub={handleOf(ABOUT.instagram)}
                />
              )}
              {ABOUT.website && (
                <LinkButton href={ABOUT.website} icon={GlobeIcon} label="Sajt" sub={hostOf(ABOUT.website)} />
              )}
            </div>
          )}

          {BUILD_TIME && (
            <p className="text-center text-[11px] text-stone-400">verzija {BUILD_TIME}</p>
          )}
        </div>
      )}
    </Card>
  )
}
