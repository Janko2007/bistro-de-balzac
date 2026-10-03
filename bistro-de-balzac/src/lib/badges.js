import { supabase } from './supabaseClient'

/**
 * Bedževi — priznanja koja admin dodeljuje radnicima (Radnik meseca, staž…).
 *
 * Spisak bedževa pravi admin; ko koji ima stoji u `worker_badges`. Svi
 * prijavljeni to vide na ekranu „Tim“, a menja samo admin.
 */

/** Svi bedževi, redom kojim ih je admin poređao. */
export async function loadBadges({ onlyActive = false } = {}) {
  let query = supabase
    .from('badges')
    .select('id, name, icon, description, sort_order, is_active')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (onlyActive) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
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
