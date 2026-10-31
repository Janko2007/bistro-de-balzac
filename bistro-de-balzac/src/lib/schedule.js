import { supabase } from './supabaseClient'

/**
 * Raspored smena.
 *
 * Admin otvara nedelju i postavlja rok za prijavu. Radnici se prijavljuju za
 * smene (uz napomenu), a admin na osnovu toga slaže raspored i objavljuje ga.
 * Nedelja počinje ponedeljkom.
 */

/* ------------------------------------------------------------------ */
/*  Datumi                                                              */
/* ------------------------------------------------------------------ */
const pad = (n) => String(n).padStart(2, '0')

/** Datum kao „2026-10-05“, po lokalnom vremenu (ne po UTC-u). */
export function isoOf(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(iso, n) {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return isoOf(d)
}

/** Ponedeljak nedelje u kojoj je dati datum. */
export function mondayOf(iso) {
  const d = parseISO(iso)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return isoOf(d)
}

export function weekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

export const DAY_NAMES = ['ponedeljak', 'utorak', 'sreda', 'četvrtak', 'petak', 'subota', 'nedelja']

/** „05.10.“ */
export function shortDate(iso) {
  const d = parseISO(iso)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`
}

/** „05.10. – 11.10.2026.“ */
export function weekLabel(weekStart) {
  const end = addDays(weekStart, 6)
  return `${shortDate(weekStart)} – ${shortDate(end)}${parseISO(end).getFullYear()}.`
}

/** Vrednost za <input type="datetime-local"> iz ISO vremena. */
export function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${isoOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Obrnuto: iz <input type="datetime-local"> u ISO vreme (ili null). */
export function fromLocalInput(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Dan u nedelji i sat, npr. "četvrtak u 20:00" — datum se ne piše. */
export function deadlineLabel(iso) {
  if (!iso) return 'bez roka'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'bez roka'
  return `${DAY_NAMES[(d.getDay() + 6) % 7]} u ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Da li su prijave još otvorene. */
export function signupsOpen(week) {
  if (!week) return false
  if (!week.signup_deadline) return true
  return Date.now() <= new Date(week.signup_deadline).getTime()
}

/* ------------------------------------------------------------------ */
/*  Smene i izgled                                                      */
/* ------------------------------------------------------------------ */
export const SHIFT_INFO = {
  prva: { label: 'I smena', short: 'Prva', roman: 'I', time: () => '7:00–15:30' },
  medjusmena: {
    label: 'Međusmena',
    short: 'Međusmena',
    roman: '',
    time: (iso) => {
      const weekend = [0, 6].includes(parseISO(iso).getDay())
      return weekend ? '12:00–20:00' : '9:00–17:00'
    },
  },
  druga: { label: 'II smena', short: 'Druga', roman: 'II', time: () => '15:30–00:00' },
}

/* ------------------------------------------------------------------ */
/*  Radno vreme po danu                                                 */
/*                                                                      */
/*  Admin može da promeni vreme bilo koje smene (i međusmene) za baš    */
/*  jedan dan. Čuva se u polju `note` nedelje kao {"hours": {...}}, pa  */
/*  ne treba nova skripta za bazu.                                      */
/* ------------------------------------------------------------------ */
export function hoursMap(week) {
  try {
    const parsed = JSON.parse(week?.note ?? '')
    return parsed && typeof parsed === 'object' && parsed.hours && typeof parsed.hours === 'object'
      ? parsed.hours
      : {}
  } catch {
    return {}
  }
}

/** Vreme smene za dati dan: izabrano, a ako ga nema — uobičajeno. */
export const timeOf = (week, shift, day) => hoursMap(week)[`${day}|${shift}`] || SHIFT_INFO[shift].time(day)

/** Da li je vreme za taj dan promenjeno. */
export const hasCustomTime = (week, shift, day) => Boolean(hoursMap(week)[`${day}|${shift}`])

/** Novi tekst polja `note` sa upisanim (ili vraćenim na uobičajeno, kad je value prazno) vremenom. */
export function withHours(week, shift, day, value) {
  const hours = { ...hoursMap(week) }
  const key = `${day}|${shift}`
  if (value) hours[key] = value
  else delete hours[key]
  return Object.keys(hours).length > 0 ? JSON.stringify({ hours }) : null
}

/**
 * Izbor vremena: dva polja <input type="time">. Iz teksta „7:00–15:30“ u
 * { from: '07:00', to: '15:30' } i nazad u tekst.
 */
export function splitTime(text) {
  const [a = '', b = ''] = String(text).split('–')
  const fix = (s) => {
    const m = s.trim().match(/^(\d{1,2}):(\d{2})$/)
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
  }
  return { from: fix(a), to: fix(b) }
}

export function joinTime(from, to) {
  const show = (s) => {
    const [h, m] = s.split(':')
    return `${h === '00' ? '00' : String(Number(h))}:${m}`
  }
  return `${show(from)}–${show(to)}`
}

/**
 * Izgled rasporeda ima dva nezavisna izbora:
 *   • koliko je ljudi u smeni (`layout`): jedna osoba ili šanker + konobar
 *   • da li postoji međusmena (`with_mid`) — uvek jedna osoba
 */
export const LAYOUTS = {
  jedan: { label: 'Po jedna osoba u smeni', slots: ['a'] },
  dvoje: { label: 'Po dvoje u smeni', slots: ['sanker', 'konobar'] },
}

export const SLOT_LABELS = { a: '', sanker: 'Šanker', konobar: 'Konobar' }

/** Da li nedelja ima međusmenu. Starije nedelje: po jedna osoba ima, po dvoje nema. */
export const hasMid = (week) =>
  typeof week?.with_mid === 'boolean' ? week.with_mid : week?.layout !== 'dvoje'

/** Smene u nedelji, redom. */
export const shiftsOf = (week) => (hasMid(week) ? ['prva', 'medjusmena', 'druga'] : ['prva', 'druga'])

/** Polja u jednoj smeni: međusmena je uvek jedna osoba. */
export const slotsOf = (week, shift) =>
  shift === 'medjusmena' ? ['a'] : (LAYOUTS[week?.layout] ?? LAYOUTS.jedan).slots

/* ------------------------------------------------------------------ */
/*  Ćirilica (za štampu)                                                */
/* ------------------------------------------------------------------ */
const DIGRAPHS = [
  ['Nj', 'Њ'], ['NJ', 'Њ'], ['nj', 'њ'],
  ['Lj', 'Љ'], ['LJ', 'Љ'], ['lj', 'љ'],
  ['Dž', 'Џ'], ['DŽ', 'Џ'], ['dž', 'џ'],
]
const SINGLE = {
  A: 'А', B: 'Б', V: 'В', G: 'Г', D: 'Д', Đ: 'Ђ', E: 'Е', Ž: 'Ж', Z: 'З', I: 'И', J: 'Ј', K: 'К',
  L: 'Л', M: 'М', N: 'Н', O: 'О', P: 'П', R: 'Р', S: 'С', T: 'Т', Ć: 'Ћ', U: 'У', F: 'Ф', H: 'Х',
  C: 'Ц', Č: 'Ч', Š: 'Ш',
  a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', đ: 'ђ', e: 'е', ž: 'ж', z: 'з', i: 'и', j: 'ј', k: 'к',
  l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', ć: 'ћ', u: 'у', f: 'ф', h: 'х',
  c: 'ц', č: 'ч', š: 'ш',
}

export function toCyrillic(text) {
  let out = String(text ?? '')
  for (const [lat, cyr] of DIGRAPHS) out = out.split(lat).join(cyr)
  return [...out].map((ch) => SINGLE[ch] ?? ch).join('')
}

/* ------------------------------------------------------------------ */
/*  Baza                                                                */
/* ------------------------------------------------------------------ */
export async function loadWeek(weekStart) {
  const { data, error } = await supabase
    .from('schedule_weeks')
    .select('id, week_start, layout, with_mid, signup_deadline, published, note')
    .eq('week_start', weekStart)
    .maybeSingle()
  if (!error) return data
  // Baza bez kolone with_mid (starija skripta -25).
  const retry = await supabase
    .from('schedule_weeks')
    .select('id, week_start, layout, signup_deadline, published, note')
    .eq('week_start', weekStart)
    .maybeSingle()
  if (retry.error) throw retry.error
  return retry.data
}

export async function createWeek({ weekStart, layout, withMid, deadline }) {
  const { data, error } = await supabase
    .from('schedule_weeks')
    .insert({ week_start: weekStart, layout, with_mid: withMid, signup_deadline: deadline })
    .select('id, week_start, layout, with_mid, signup_deadline, published, note')
    .single()
  if (error) throw error
  return data
}

export async function updateWeek(id, patch) {
  const { error } = await supabase.from('schedule_weeks').update(patch).eq('id', id)
  if (error) throw error
}

/** Sve nedelje pre date (ponedeljak), najnovije prvo — za brisanje starih rasporeda. */
export async function loadPastWeeks(beforeWeekStart) {
  const { data, error } = await supabase
    .from('schedule_weeks')
    .select('id, week_start')
    .lt('week_start', beforeWeekStart)
    .order('week_start', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function deleteWeek(id) {
  const { error } = await supabase.from('schedule_weeks').delete().eq('id', id)
  if (error) throw error
}

/** Prijave: radnik dobija samo svoje, admin sve (to rešava baza). */
export async function loadSignups(weekId) {
  const { data, error } = await supabase
    .from('schedule_signups')
    .select('id, profile_id, day, shift, note')
    .eq('week_id', weekId)
  if (error) throw error
  return data ?? []
}

export async function addSignup(weekId, profileId, day, shift) {
  const { data, error } = await supabase
    .from('schedule_signups')
    .insert({ week_id: weekId, profile_id: profileId, day, shift })
    .select('id, profile_id, day, shift, note')
    .single()
  if (error) throw error
  return data
}

export async function removeSignup(id) {
  const { error } = await supabase.from('schedule_signups').delete().eq('id', id)
  if (error) throw error
}

export async function saveSignupNote(id, note) {
  const { error } = await supabase
    .from('schedule_signups')
    .update({ note: note.trim() || null })
    .eq('id', id)
  if (error) throw error
}

export async function loadSlots(weekId) {
  const { data, error } = await supabase
    .from('schedule_slots')
    .select('id, day, shift, slot, profile_id')
    .eq('week_id', weekId)
  if (error) throw error
  return data ?? []
}

/** Upisuje ili briše osobu u jednom polju rasporeda. */
export async function setSlot({ weekId, day, shift, slot, profileId }) {
  if (!profileId) {
    const { error } = await supabase
      .from('schedule_slots')
      .delete()
      .eq('week_id', weekId)
      .eq('day', day)
      .eq('shift', shift)
      .eq('slot', slot)
    if (error) throw error
    return
  }
  const { error } = await supabase
    .from('schedule_slots')
    .upsert(
      { week_id: weekId, day, shift, slot, profile_id: profileId },
      { onConflict: 'week_id,day,shift,slot' },
    )
  if (error) throw error
}

/** Radnici koji mogu da budu u rasporedu. */
export async function loadPeople() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, position, role, is_active, is_deleted, avatar_path, pay_model, daily_wage')
    .eq('is_deleted', false)
    .eq('is_active', true)
    .order('full_name')
  if (error) throw error
  return data ?? []
}
