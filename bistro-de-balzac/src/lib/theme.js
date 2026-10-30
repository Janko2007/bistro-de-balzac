import { useEffect, useState } from 'react'

/**
 * Boja aplikacije koju radnik bira u Profilu.
 *
 * Menja gornju traku i donju navigaciju. Ostatak aplikacije ostaje isti, a iz
 * izabrane boje se izvode sve ostale (tamnija, svetlija, boja teksta), da se
 * uvek lepo uklapa. Pamti se na telefonu, posebno za svakog radnika.
 * Bez izbora (`null`) važi početni izgled.
 */
export const THEME_PRESETS = [
  { key: 'pocetna', name: 'Početna', color: null },
  { key: 'suma', name: 'Šuma', color: '#166534' },
  { key: 'okean', name: 'Okean', color: '#1e40af' },
  { key: 'tirkiz', name: 'Tirkiz', color: '#0f766e' },
  { key: 'sljiva', name: 'Šljiva', color: '#6b21a8' },
  { key: 'bordo', name: 'Bordo', color: '#9f1239' },
  { key: 'cigla', name: 'Cigla', color: '#c2410c' },
  { key: 'senf', name: 'Senf', color: '#a16207' },
  { key: 'grafit', name: 'Grafit', color: '#334155' },
]

const EVENT = 'bdb-theme'
const keyFor = (profileId) => `bdb.theme.${profileId || 'gost'}`

export function getThemeColor(profileId) {
  try {
    const v = window.localStorage.getItem(keyFor(profileId))
    return /^#[0-9a-f]{6}$/i.test(v ?? '') ? v.toLowerCase() : null
  } catch {
    return null
  }
}

export function setThemeColor(profileId, color) {
  try {
    if (color) window.localStorage.setItem(keyFor(profileId), color)
    else window.localStorage.removeItem(keyFor(profileId))
  } catch {
    /* privatni prozor — izbor važi dok je aplikacija otvorena */
  }
  window.dispatchEvent(new Event(EVENT))
}

/** Izabrana boja, uz osvežavanje čim se promeni (Profil → Layout). */
export function useThemeColor(profileId) {
  const [color, setColor] = useState(() => getThemeColor(profileId))

  useEffect(() => {
    const update = () => setColor(getThemeColor(profileId))
    update()
    window.addEventListener(EVENT, update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(EVENT, update)
      window.removeEventListener('storage', update)
    }
  }, [profileId])

  return color
}

/* ------------------------------------------------------------------ */
/*  Računanje boja                                                      */
/* ------------------------------------------------------------------ */
function toRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex([r, g, b]) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** Meša dve boje: t=0 je prva, t=1 druga. */
function mix(a, b, t) {
  const x = toRgb(a)
  const y = toRgb(b)
  return toHex(x.map((v, i) => v + (y[i] - v) * t))
}

/** Svetlina po WCAG-u (0 crno … 1 belo). */
function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Zatamnjuje boju dok na podlozi nije čitljiva. */
function readableOn(color, background, min = 4.5) {
  let out = color
  for (let i = 0; i < 12 && contrast(out, background) < min; i += 1) out = mix(out, '#000000', 0.12)
  return out
}

const PAPER = '#fbf9f5'

/**
 * Sve boje za gornju traku i donju navigaciju iz jedne izabrane boje.
 * Vraća null za početni izgled.
 */
export function deriveTheme(color) {
  if (!color) return null

  // Previše svetla boja se zatamni, da bela slova na traci ostanu čitljiva.
  let base = color
  for (let i = 0; i < 12 && contrast(base, '#ffffff') < 4.5; i += 1) base = mix(base, '#000000', 0.1)

  const navBg = mix(PAPER, base, 0.1)
  return {
    base,
    headerBg: base,
    headerBorder: mix(base, '#000000', 0.25),
    headerText: '#ffffff',
    headerSub: mix(base, '#ffffff', 0.72),
    headerHover: 'rgba(0,0,0,.18)',
    headerActive: 'rgba(0,0,0,.26)',
    avatarBg: 'rgba(255,255,255,.2)',
    navBg: `${navBg}f2`,
    navBorder: mix(PAPER, base, 0.28),
    navActive: readableOn(base, navBg),
  }
}
