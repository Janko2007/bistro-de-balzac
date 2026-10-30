import { useState } from 'react'

import { useAuth } from '../context/AuthContext'
import { THEME_PRESETS, deriveTheme, setThemeColor, useThemeColor } from '../lib/theme'
import { cx } from '../lib/utils'
import { Card } from './ui'

/**
 * Boja aplikacije (Profil, radnik): bira se gotova boja ili bilo koja druga.
 * Menja gornju traku i donju navigaciju; sve ostalo ostaje isto.
 */
export default function ThemePicker() {
  const { profile } = useAuth()
  const current = useThemeColor(profile?.id)
  const [open, setOpen] = useState(false)

  const choose = (color) => setThemeColor(profile?.id, color)
  const isPreset = THEME_PRESETS.some((p) => p.color === current)
  const preview = deriveTheme(current)

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
          Boja aplikacije
        </span>
        <span
          className="h-5 w-5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
          style={{ backgroundColor: current ?? '#1c1917' }}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-stone-100 p-4">
          {/* Mali prikaz: gornja traka i donja navigacija u izabranoj boji. */}
          <div className="overflow-hidden rounded-2xl ring-1 ring-inset ring-stone-200" aria-hidden="true">
            <div
              className="flex items-center gap-2 px-3 py-2.5"
              style={{
                backgroundColor: preview?.headerBg ?? '#1c1917',
                color: preview?.headerText ?? '#ffffff',
              }}
            >
              <span className="h-5 w-5 rounded-md bg-white/25" />
              <span className="text-xs font-bold">Bistro de Balzac</span>
            </div>
            <div className="h-10 bg-stone-100" />
            <div
              className="flex items-center justify-around px-3 py-2 text-[10px] font-semibold"
              style={{
                backgroundColor: preview?.navBg ?? '#fbf9f5',
                borderTop: `1px solid ${preview?.navBorder ?? '#e7e5e4'}`,
              }}
            >
              <span style={{ color: preview?.navActive ?? '#ef5f07' }}>Novi popis</span>
              <span className="text-stone-500">Izveštaji</span>
              <span className="text-stone-500">Profil</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {THEME_PRESETS.map((p) => {
              const active = (p.color ?? null) === current
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => choose(p.color)}
                  aria-pressed={active}
                  aria-label={p.name}
                  title={p.name}
                  className="flex w-14 flex-col items-center gap-1"
                >
                  <span
                    className={cx(
                      'flex h-11 w-11 items-center justify-center rounded-full text-base font-bold text-white ring-offset-2 transition',
                      active ? 'ring-2 ring-stone-900' : 'ring-1 ring-black/10 hover:scale-105',
                    )}
                    style={{ backgroundColor: p.color ?? '#1c1917' }}
                  >
                    {active ? '✓' : ''}
                  </span>
                  <span className="text-[11px] font-medium text-stone-500">{p.name}</span>
                </button>
              )
            })}

            {/* Bilo koja boja */}
            <label className="flex w-14 cursor-pointer flex-col items-center gap-1">
              <span
                className={cx(
                  'relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full text-base font-bold ring-offset-2 transition',
                  current && !isPreset ? 'ring-2 ring-stone-900' : 'ring-1 ring-black/10 hover:scale-105',
                )}
                style={{
                  background:
                    current && !isPreset
                      ? current
                      : 'conic-gradient(#ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)',
                }}
              >
                <span className="text-white drop-shadow">{current && !isPreset ? '✓' : ''}</span>
                <input
                  type="color"
                  value={current ?? '#166534'}
                  onChange={(e) => choose(e.target.value)}
                  aria-label="Izaberi svoju boju"
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </span>
              <span className="text-[11px] font-medium text-stone-500">Svoja</span>
            </label>
          </div>

          <p className="text-[12px] text-stone-400">
            Menja gornju traku i donju navigaciju. Pamti se na ovom telefonu.
          </p>
        </div>
      )}
    </Card>
  )
}
