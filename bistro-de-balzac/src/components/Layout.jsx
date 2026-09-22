import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { APP_NAME } from '../lib/supabaseClient'
import { cx } from '../lib/utils'
import Avatar from './Avatar'
import { Button } from './ui'
import InstallPrompt from './InstallPrompt'

/* Ikone (inline SVG — bez dodatnih biblioteka) */
const icons = {
  plus: 'M12 5v14M5 12h14',
  list: 'M4 6h16M4 12h16M4 18h16',
  grid: 'M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z',
  box: 'M4 7l8-4 8 4v10l-8 4-8-4V7zM4 7l8 4 8-4M12 11v10',
  // Dvoje ljudi: prednji ceo, zadnji naznačen glavom i ramenom iza njega.
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M13 7a4 4 0 11-8 0 4 4 0 018 0M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  money: 'M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5 9.2 10 12 10s5 1.1 5 3.5-2.2 3.5-5 3.5-5-1.1-5-3.5',
  // Čovečuljak — profil radnika
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M16 7a4 4 0 11-8 0 4 4 0 018 0',
  // Novčanica sa kovanicom u sredini — uplate pazara
  bank: 'M4 6h16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5M6 10v4M18 10v4',
}

function Icon({ path, className = 'h-5 w-5' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  )
}

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const navItems = isAdmin
    ? [
        { to: '/', label: 'Pregled', icon: icons.grid, end: true },
        { to: '/uplate', label: 'Uplate', icon: icons.bank },
        { to: '/artikli', label: 'Artikli', icon: icons.box },
        { to: '/radnici', label: 'Radnici', icon: icons.users },
        { to: '/novi-popis', label: 'Popis', icon: icons.plus },
      ]
    : [
        { to: '/', label: 'Novi popis', icon: icons.plus, end: true },
        { to: '/moji-izvestaji', label: 'Izveštaji', icon: icons.list },
        { to: '/profil', label: 'Profil', icon: icons.user },
      ]

  async function handleSignOut() {
    setMenuOpen(false)
    await signOut()
    navigate('/prijava', { replace: true })
  }

  return (
    // Dole ima mesta za donju navigaciju — na iPhone-u i za prostor iznad
    // crte za gašenje aplikacije, da poslednja kartica ne ostane ispod nje.
    <div className="min-h-screen bg-slate-100 pb-[calc(76px+env(safe-area-inset-bottom,0px))] lg:pb-0">
      {/* ---------- Gornja traka ---------- */}
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink text-white safe-top">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <img
            src="/icons/icon-192.png"
            alt=""
            className="h-9 w-9 shrink-0 rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight">{APP_NAME}</p>
            <p className="truncate text-xs text-stone-400">
              {isAdmin ? 'Vlasnik' : 'Radnik'} · {profile?.full_name}
            </p>
          </div>

          {/* Desktop navigacija */}
          <nav className="hidden items-center gap-1 lg:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition',
                    isActive ? 'bg-ink-800 text-white' : 'text-stone-300 hover:bg-ink-800/60',
                  )
                }
              >
                <Icon path={item.icon} className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-full transition hover:opacity-90"
              aria-label="Meni naloga"
            >
              <Avatar
                name={profile?.full_name}
                path={profile?.avatar_path}
                className="h-9 w-9 bg-ink-700 text-xs text-white"
              />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-xl">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="truncate text-sm font-bold">{profile?.full_name}</p>
                    <p className="truncate text-xs text-slate-500">{profile?.email}</p>
                  </div>
                  <div className="p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={handleSignOut}
                    >
                      Odjavi se
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ---------- Sadržaj ---------- */}
      <main className="mx-auto w-full max-w-6xl px-4 py-5">
        <Outlet />
      </main>

      <InstallPrompt />

      {/* ---------- Donja navigacija (mobilni) ---------- */}
      {/* Fiksna visina i zabranjen prelom teksta — dugmad stoje na istom
          mestu bez obzira na to koja je sekcija otvorena. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur safe-bottom lg:hidden">
        <div className="mx-auto flex max-w-lg">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx(
                  'flex h-[56px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5',
                  'text-[11px] font-semibold transition-colors',
                  isActive ? 'text-brand-600' : 'text-slate-500',
                )
              }
            >
              <Icon path={item.icon} />
              <span className="w-full truncate px-1 text-center leading-tight">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
