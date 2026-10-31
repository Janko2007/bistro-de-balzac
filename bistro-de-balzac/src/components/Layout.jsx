import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { APP_NAME } from '../lib/supabaseClient'
import { cx } from '../lib/utils'
import { clearPersistedState } from '../lib/persist'
import { deriveTheme, useThemeColor } from '../lib/theme'
import Avatar from './Avatar'
import InstallPrompt from './InstallPrompt'
import AnnouncementGate from './AnnouncementGate'

/* Vreme pravljenja verzije — upisuje ga Vite pri objavi (vidi vite.config.js).
   U razvoju te promenljive nema, pa stoji rezerva. */

/* Ikone (inline SVG — bez dodatnih biblioteka) */
const icons = {
  plus: 'M12 5v14M5 12h14',
  // Beležnica sa štikliranom stavkom — popis
  clipboard: 'M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2M9 2h6a1 1 0 011 1v2a1 1 0 01-1 1H9a1 1 0 01-1-1V3a1 1 0 011-1zM9 14l2 2 4-4',
  list: 'M4 6h16M4 12h16M4 18h16',
  grid: 'M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z',
  box: 'M4 7l8-4 8 4v10l-8 4-8-4V7zM4 7l8 4 8-4M12 11v10',
  // Dvoje ljudi: prednji ceo, zadnji naznačen glavom i ramenom iza njega.
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M13 7a4 4 0 11-8 0 4 4 0 018 0M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  money: 'M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5 9.2 10 12 10s5 1.1 5 3.5-2.2 3.5-5 3.5-5-1.1-5-3.5',
  // Čovečuljak — profil radnika
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M16 7a4 4 0 11-8 0 4 4 0 018 0',
  // Novčanica sa kovanicom u sredini — uplate pazara
  // Kalendar — raspored smena
  calendar: 'M4 6a2 2 0 012-2h12a2 2 0 012 2v13a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM4 10h16M8 2v4M16 2v4',
  // Zupčanik — podešavanja
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z',
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

/**
 * Pamti dokle si skrolovao na svakom ekranu.
 *
 * Povratak nazad (npr. iz otvorenog izveštaja na spisak) vraća te tačno tamo
 * gde si stao, a otvaranje novog ekrana kreće od vrha.
 */
function useScrollMemory() {
  const location = useLocation()
  const navType = useNavigationType()
  const positions = useRef(new Map())
  // Glavne sekcije (donja navigacija) pamte mesto i kad im se vraćaš dodirom
  // na njih, ne samo strelicom nazad — nastavljaš gde si stao.
  const byPath = useRef(new Map())

  useEffect(() => {
    const key = location.key
    const path = location.pathname
    const isSection = !path.startsWith('/izvestaj')
    const saved = positions.current.get(key) ?? (isSection ? byPath.current.get(path) : undefined)

    let frame = 0
    if (typeof saved === 'number' && (navType === 'POP' || isSection)) {
      // Lista se često tek učitava — skrol se pokušava dok stranica ne naraste
      // do pozicije na kojoj si stao (najviše oko dve sekunde).
      const startedAt = performance.now()
      const restore = () => {
        window.scrollTo(0, saved)
        const reached = Math.abs(window.scrollY - saved) < 2
        if (!reached && performance.now() - startedAt < 2000) frame = requestAnimationFrame(restore)
      }
      frame = requestAnimationFrame(restore)
    } else {
      window.scrollTo(0, 0)
    }

    return () => {
      cancelAnimationFrame(frame)
      positions.current.set(key, window.scrollY)
      if (isSection) byPath.current.set(path, window.scrollY)
    }
  }, [location.key, location.pathname, navType])
}

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  useScrollMemory()

  // Boju gornje i donje trake bira svako za sebe: radnik u Profilu, admin u Radnici (dno).
  const themeColor = useThemeColor(profile?.id)
  const theme = deriveTheme(themeColor)

  // Boja trake pregledača/telefona prati izabranu boju.
  const headerColor = theme?.headerBg ?? null
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) return undefined
    if (!meta.dataset.original) meta.dataset.original = meta.getAttribute('content') ?? ''
    meta.setAttribute('content', headerColor ?? meta.dataset.original)
    return undefined
  }, [headerColor])

  const navItems = isAdmin
    ? [
        { to: '/', label: 'Pregled', icon: icons.grid, end: true },
        { to: '/radnici', label: 'Radnici', icon: icons.users },
        { to: '/raspored', label: 'Raspored', icon: icons.calendar },
        { to: '/novi-popis', label: 'Popis', icon: icons.clipboard },
        { to: '/podesavanja', label: 'Postavke', icon: icons.gear },
      ]
    : [
        { to: '/', label: 'Novi popis', icon: icons.clipboard, end: true },
        { to: '/raspored', label: 'Raspored', icon: icons.calendar },
        { to: '/profil', label: 'Profil', icon: icons.user },
      ]

  async function handleSignOut() {
    setMenuOpen(false)
    clearPersistedState()
    await signOut()
    navigate('/prijava', { replace: true })
  }

  return (
    // Dole ima mesta za donju navigaciju — na iPhone-u i za prostor iznad
    // crte za gašenje aplikacije, da poslednja kartica ne ostane ispod nje.
    <div className="min-h-screen bg-stone-100 pb-[calc(76px+env(safe-area-inset-bottom,0px))] lg:pb-0">
      {/* ---------- Gornja traka ---------- */}
      <header
        className="sticky top-0 z-30 border-b border-ink-800 bg-ink text-white safe-top"
        style={theme ? { backgroundColor: theme.headerBg, borderColor: theme.headerBorder, color: theme.headerText } : undefined}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <img
            src="/icons/icon-192.png"
            alt=""
            className="h-9 w-9 shrink-0 rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight">{APP_NAME}</p>
            <p className="truncate text-xs text-stone-400" style={theme ? { color: theme.headerSub } : undefined}>
              {isAdmin ? 'Admin' : 'Radnik'} · {profile?.full_name}
            </p>
          </div>

          {/* Desktop navigacija */}
          <nav className="hidden items-center gap-1 lg:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                aria-label={item.label}
                title={item.label}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition',
                    isActive ? 'bg-ink-800 text-white' : 'text-stone-300 hover:bg-ink-800/60',
                  )
                }
                style={({ isActive }) =>
                  theme && isActive ? { backgroundColor: theme.headerActive } : undefined
                }
              >
                <Icon path={item.icon} className={isAdmin ? 'h-4 w-4' : 'h-5 w-5'} />
                {isAdmin && item.label}
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
                className={cx('h-9 w-9 text-xs text-white', isAdmin ? 'bg-violet-600' : theme ? 'bg-white/20' : 'bg-ink-700')}
              />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-stone-200 bg-white text-stone-900 shadow-xl">
                  <div className="border-b border-stone-100 px-4 py-3">
                    <p className="truncate text-sm font-bold">{profile?.full_name}</p>
                  </div>
                  <div className="p-2">
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-rose-600 transition hover:bg-rose-50 active:bg-rose-100"
                    >
                      Odjavi se
                    </button>
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

      {/* Obaveštenja koja iskaču jednom — čim se radnik prijavi ili vrati u aplikaciju. */}
      <AnnouncementGate />

      {/* ---------- Donja navigacija (mobilni) ---------- */}
      {/* Fiksna visina i zabranjen prelom teksta — dugmad stoje na istom
          mestu bez obzira na to koja je sekcija otvorena. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200/80 bg-white/90 shadow-[0_-8px_24px_-12px_rgba(28,25,23,0.18)] backdrop-blur-xl safe-bottom lg:hidden"
        style={theme ? { backgroundColor: theme.navBg, borderColor: theme.navBorder } : undefined}
      >
        <div className="mx-auto flex max-w-lg px-1.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              aria-label={item.label}
              title={item.label}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx(
                  'group flex h-[56px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5',
                  'text-[11px] font-semibold transition-colors',
                  isActive ? 'text-brand-600' : 'text-stone-400 hover:text-stone-600',
                )
              }
              style={({ isActive }) => (theme && isActive ? { color: theme.navActive } : undefined)}
            >
              {({ isActive }) => (
                <>
                  {/* Aktivna sekcija: znak u blagoj pločici boje aplikacije. */}
                  <span
                    className={cx(
                      'flex items-center justify-center rounded-2xl transition-all duration-200',
                      isAdmin ? 'h-7 w-14' : 'h-11 w-[72px]',
                      isActive ? 'bg-brand-100/80 shadow-sm' : 'group-active:bg-stone-100',
                    )}
                    style={isActive && theme ? { backgroundColor: `${theme.navActive}24` } : undefined}
                  >
                    <Icon
                      path={item.icon}
                      className={cx(isAdmin ? 'h-5 w-5' : 'h-[26px] w-[26px]', isActive && 'scale-105')}
                    />
                  </span>
                  {isAdmin && (
                    <span className="w-full truncate px-1 text-center leading-none">{item.label}</span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>    </div>
  )
}
