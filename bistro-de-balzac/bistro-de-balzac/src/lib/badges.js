import { supabase } from './supabaseClient'

/**
 * Bedževi — priznanja koja admin dodeljuje radnicima (Radnik meseca, staž…).
 *
 * Spisak bedževa pravi admin; ko koji ima stoji u `worker_badges`. Svi
 * prijavljeni to vide na ekranu „Tim“, a menja samo admin. Uz svaki bedž
 * stoji i šta je potrebno da se dobije, a posebno se vodi spisak radnika
 * meseca (`monthly_winners`).
 */

/** Svi bedževi, redom kojim ih je admin poređao. */
export async function loadBadges({ onlyActive = false } = {}) {
  const build = (columns) => {
    let query = supabase
      .from('badges')
      .select(columns)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (onlyActive) query = query.eq('is_active', true)
    return query
  }

  let { data, error } = await build('id, name, icon, description, requirement, sort_order, is_active')

  // Baza u kojoj skripta za uslove još nije puštena nema kolonu `requirement`.
  if (error) {
    const fallback = await build('id, name, icon, description, sort_order, is_active')
    if (fallback.error) throw fallback.error
    data = fallback.data
  }

  return (data ?? []).map((b) => ({ ...b, requirement: b.requirement ?? '' }))
}

/** Dodele: profil -> spisak id-jeva bedževa. */
export async function loadWorkerBadges() {
  const { data, error } = await supabase
    .from('worker_badges')
    .select('profile_id, badge_id, note, awarded_at')

  if (error) throw error

  const map = new Map()
  for (const row of data ?? []) {
    if (!map.has(row.profile_id)) map.set(row.profile_id, [])
    map.get(row.profile_id).push(row)
  }
  return map
}

/**
 * Upisuje tačno one bedževe koje admin ostavi označene kod radnika.
 * Skinuti se brišu, novi se dodaju, postojeći se ne diraju.
 */
export async function saveWorkerBadges(profileId, badgeIds, current, awardedBy) {
  const imao = new Set((current ?? []).map((b) => b.badge_id))
  const treba = new Set(badgeIds)

  const zaBrisanje = [...imao].filter((id) => !treba.has(id))
  const zaDodavanje = [...treba].filter((id) => !imao.has(id))

  if (zaBrisanje.length > 0) {
    const { error } = await supabase
      .from('worker_badges')
      .delete()
      .eq('profile_id', profileId)
      .in('badge_id', zaBrisanje)
    if (error) throw error
  }

  if (zaDodavanje.length > 0) {
    const { error } = await supabase.from('worker_badges').insert(
      zaDodavanje.map((badge_id) => ({
        profile_id: profileId,
        badge_id,
        awarded_by: awardedBy ?? null,
      })),
    )
    if (error) throw error
  }
}

/* ------------------------------------------------------------------ */
/*  Radnici meseca                                                     */
/* ------------------------------------------------------------------ */
const MESECI = [
  'januar',
  'februar',
  'mart',
  'april',
  'maj',
  'jun',
  'jul',
  'avgust',
  'septembar',
  'oktobar',
  'novembar',
  'decembar',
]

/** „2026-10-01“ → „oktobar 2026“ */
export function monthLabel(dateISO) {
  const [y, m] = String(dateISO ?? '').split('-')
  const name = MESECI[Number(m) - 1]
  return name ? `${name} ${y}` : '—'
}

/** Svi radnici meseca, najnoviji mesec prvi. Bez tabele — prazan spisak. */
export async function loadMonthlyWinners() {
  const { data, error } = await supabase
    .from('monthly_winners')
    .select('id, month, profile_id, note')
    .order('month', { ascending: false })

  if (error) {
    console.error(error)
    return []
  }
  return data ?? []
}
