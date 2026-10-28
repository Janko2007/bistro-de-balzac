import { supabase } from './supabaseClient'
import { compressImage } from './image'

/**
 * Obaveštenja — admin ih šalje svima ili jednoj osobi; radnik ih vidi jednom
 * (kad se prijavi ili otvori aplikaciju), a posle ostaju sačuvana u Profilu.
 *
 * Bedž i radnik meseca prave obaveštenje sami (okidači u bazi).
 */

export const KINDS = {
  poruka: { label: 'Poruka', icon: '💬' },
  slavlje: { label: 'Slavlje', icon: '🎉' },
  dnevnica: { label: 'Dnevnica', icon: '💸' },
  bedz: { label: 'Bedž', icon: '🏅' },
  radnik_meseca: { label: 'Radnik meseca', icon: '🏆' },
}

export const EFFECTS = [
  { value: 'bez', label: 'Bez efekta' },
  { value: 'konfete', label: '🎊 Konfete' },
  { value: 'vatromet', label: '🎆 Vatromet' },
]

/** Sva obaveštenja koja su MENI namenjena (za sve ili baš za mene), najnovije prvo. */
export async function loadMine(profileId) {
  const [list, reads] = await Promise.all([
    supabase
      .from('announcements')
      .select('id, kind, title, body, icon, image_path, effect, target_profile_id, subject_id, created_at')
      .or(`target_profile_id.is.null,target_profile_id.eq.${profileId}`)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('announcement_reads').select('announcement_id').eq('profile_id', profileId),
  ])

  // Tabela ne postoji dok skripta za bazu nije puštena — tada nema obaveštenja.
  if (list.error || reads.error) return { items: [], seen: new Set(), missing: true }

  return {
    items: list.data ?? [],
    seen: new Set((reads.data ?? []).map((r) => r.announcement_id)),
    missing: false,
  }
}

/** Zapamti da je radnik ovo video — više mu ne iskače. */
export async function markSeen(announcementId, profileId) {
  const { error } = await supabase
    .from('announcement_reads')
    .upsert(
      { announcement_id: announcementId, profile_id: profileId },
      { onConflict: 'announcement_id,profile_id', ignoreDuplicates: true },
    )
  if (error) console.error(error)
}

/** Slika obaveštenja → adresa koja važi sat vremena (bucket je privatan). */
export async function imageUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('izvestaji').createSignedUrl(path, 60 * 60)
  return error ? null : data?.signedUrl ?? null
}

/** Šalje sliku u folder obavestenja/ i vraća putanju. */
export async function uploadImage(file) {
  const compressed = await compressImage(file)
  const ext = (compressed.type?.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
  const path = `obavestenja/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage
    .from('izvestaji')
    .upload(path, compressed, { contentType: compressed.type, upsert: false })
  if (error) throw error
  return path
}

/** Admin: novo obaveštenje. Sam admin ga ne vidi kao nepročitano. */
export async function createAnnouncement(payload, adminId) {
  const { data, error } = await supabase
    .from('announcements')
    .insert({ ...payload, created_by: adminId })
    .select('id')
    .single()
  if (error) throw error
  // Onaj ko ga šalje ne mora da ga čita — upisuje se kao viđeno.
  await markSeen(data.id, adminId)
  return data.id
}

/** Admin: sva poslata obaveštenja (i ona automatska). */
export async function loadAll() {
  const { data, error } = await supabase
    .from('announcements')
    .select('id, kind, title, body, icon, image_path, effect, target_profile_id, subject_id, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return []
  return data ?? []
}

export async function removeAnnouncement(item) {
  const { error } = await supabase.from('announcements').delete().eq('id', item.id)
  if (error) throw error
  if (item.image_path) {
    await supabase.storage.from('izvestaji').remove([item.image_path])
  }
}

/** Koliko je ljudi videlo obaveštenje (admin). */
export async function loadReadCounts() {
  const { data, error } = await supabase.from('announcement_reads').select('announcement_id')
  if (error) return new Map()
  const map = new Map()
  for (const r of data ?? []) map.set(r.announcement_id, (map.get(r.announcement_id) ?? 0) + 1)
  return map
}
