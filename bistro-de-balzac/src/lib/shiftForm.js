import { supabase } from './supabaseClient'

/**
 * Izgled smene — šta radnik vidi u smeni i kojim redom.
 *
 * Admin ga menja u Artikli → Izgled smene. Čuva se kao jedan red u
 * `app_settings` (ključ „shift_form“). Dok ga nema, važi početni izgled.
 */
export const SETTINGS_KEY = 'shift_form'

/** Delovi smene. `canHide` — može li admin da ga sakrije (obavezni ne mogu). */
export const SECTIONS = [
  { key: 'popis', label: 'Popis artikala', canHide: false },
  { key: 'pazar', label: 'Pazar', canHide: false },
  { key: 'slika', label: 'Slika izveštaja', canHide: false },
  { key: 'obaveza', label: 'Dnevna obaveza', canHide: true },
  { key: 'napomena', label: 'Napomena', canHide: true },
  { key: 'dodatno', label: 'Dodatno', canHide: true },
]

export const FIELD_TYPES = [
  { value: 'novac', label: 'Novac' },
  { value: 'broj', label: 'Broj' },
  { value: 'tekst', label: 'Tekst' },
  { value: 'da_ne', label: 'Da / ne' },
]

export const DEFAULT_LAYOUT = {
  order: SECTIONS.map((s) => s.key),
  titles: {},
  hidden: [],
  fields: [],
}

/** Dopunjava sve što fali (nov deo smene, stari zapis), da ništa ne nestane. */
export function normalizeLayout(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const known = SECTIONS.map((s) => s.key)

  const order = [
    ...(Array.isArray(src.order) ? src.order.filter((k) => known.includes(k)) : []),
  ]
  for (const key of known) if (!order.includes(key)) order.push(key)

  const hidden = (Array.isArray(src.hidden) ? src.hidden : []).filter((k) =>
    SECTIONS.some((s) => s.key === k && s.canHide),
  )

  const titles = {}
  if (src.titles && typeof src.titles === 'object') {
    for (const key of known) {
      const t = String(src.titles[key] ?? '').trim()
      if (t) titles[key] = t
    }
  }

  const fields = (Array.isArray(src.fields) ? src.fields : [])
    .filter((f) => f && f.id && String(f.label ?? '').trim())
    .map((f) => ({
      id: String(f.id),
      label: String(f.label).trim(),
      type: FIELD_TYPES.some((t) => t.value === f.type) ? f.type : 'tekst',
      required: f.required === true,
    }))

  return { order, titles, hidden, fields }
}

export async function loadLayout() {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .maybeSingle()
    if (error) return normalizeLayout(null)
    return normalizeLayout(data?.value)
  } catch {
    return normalizeLayout(null)
  }
}

export async function saveLayout(layout) {
  const { error } = await supabase
    .from('app_settings')
    .upsert(
      { key: SETTINGS_KEY, value: normalizeLayout(layout), updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
  if (error) throw error
}

/** Naslov dela smene — admin ga je možda preimenovao. */
export function titleOf(layout, key) {
  return layout.titles[key] || SECTIONS.find((s) => s.key === key)?.label || key
}

/** Novi, kratak, jedinstven id za dodatno polje. */
export function newFieldId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

/** „Dodatna polja“ kako se čuvaju u izveštaju: i naziv, da stari izveštaji ostanu čitljivi. */
export function packExtras(layout, values) {
  const out = {}
  for (const f of layout.fields) {
    const v = values[f.id]
    if (v === undefined || v === '' || v === null) continue
    out[f.id] = { label: f.label, type: f.type, value: v }
  }
  return out
}

/** Obrnuto: iz izveštaja u { id: vrednost }. */
export function unpackExtras(extras) {
  const out = {}
  if (extras && typeof extras === 'object') {
    for (const [id, entry] of Object.entries(extras)) out[id] = entry?.value ?? ''
  }
  return out
}
