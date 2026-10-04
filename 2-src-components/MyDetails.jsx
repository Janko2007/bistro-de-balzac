import { useEffect, useState } from 'react'

import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { cx, errorMessage } from '../lib/utils'
import { Button, Card, Field, Input, Textarea } from './ui'

const MAX_EXPERIENCE = 1500

/**
 * Moji podaci — radnik sam upisuje svoj telefon i opis radnog iskustva.
 *
 * Zatvoreno dok se ne klikne, da Profil ne bude predug. Iskustvo vide samo
 * radnik i admin. Kolona `experience` se učitava odvojeno od profila: ako
 * skripta za bazu još nije puštena, prijava ostaje ispravna a polje za
 * iskustvo se jednostavno ne prikazuje.
 */
export default function MyDetails() {
  const { profile, refreshProfile } = useAuth()
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [experience, setExperience] = useState('')
  const [hasExperience, setHasExperience] = useState(true)
  const [saved, setSaved] = useState({ phone: profile?.phone ?? '', experience: '' })
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!profile?.id) return undefined
    let active = true

    async function load() {
      const [phoneRes, detailsRes] = await Promise.all([
        supabase.from('profiles').select('phone').eq('id', profile.id).single(),
        supabase
          .from('profile_details')
          .select('experience')
          .eq('profile_id', profile.id)
          .maybeSingle(),
      ])
      if (!active) return

      // Tabela još ne postoji (skripta nije puštena) — radi se samo sa telefonom.
      setHasExperience(!detailsRes.error)

      const p = phoneRes.data?.phone ?? ''
      const e = detailsRes.error ? '' : (detailsRes.data?.experience ?? '')
      setPhone(p)
      setExperience(e)
      setSaved({ phone: p, experience: e })
    }

    load()
    return () => {
      active = false
    }
  }, [profile?.id])

  const dirty = phone.trim() !== saved.phone.trim() || experience !== saved.experience

  async function save(e) {
    e.preventDefault()
    setWorking(true)

    const phoneRes = await supabase
      .from('profiles')
      .update({ phone: phone.trim() || null })
      .eq('id', profile.id)

    let error = phoneRes.error
    if (!error && hasExperience) {
      const detailsRes = await supabase.from('profile_details').upsert(
        {
          profile_id: profile.id,
          experience: experience.trim(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'profile_id' },
      )
      error = detailsRes.error
    }
    setWorking(false)

    if (error) return toast.error(errorMessage(error, 'Podaci nisu sačuvani.'))

    setSaved({ phone: phone.trim(), experience: experience.trim() })
    setExperience(experience.trim())
    toast.success('Podaci su sačuvani.')
    refreshProfile()
  }

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
          className={cx(
            'h-4 w-4 shrink-0 text-stone-400 transition-transform',
            open && 'rotate-90',
          )}
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
        <span className="min-w-0 flex-1">
          <span className="block text-base font-extrabold tracking-tight text-stone-900">
            Moji podaci
          </span>
          <span className="block truncate text-xs text-stone-400">
            {saved.phone || 'upiši telefon'}
            {hasExperience && ` · ${saved.experience ? 'iskustvo upisano' : 'upiši iskustvo'}`}
          </span>
        </span>
      </button>

      {open && (
        <form onSubmit={save} className="space-y-4 border-t border-stone-100 p-4">
          <Field label="Broj telefona">
            <Input
              type="tel"
              inputMode="tel"
              value={phone}
              maxLength={30}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="064 123 4567"
            />
          </Field>

          {hasExperience && (
            <Field
              label="Radno iskustvo"
              hint="Gde si radio, koliko dugo, šta znaš. Vidiš ga samo ti i admin."
            >
              <Textarea
                rows={6}
                value={experience}
                maxLength={MAX_EXPERIENCE}
                onChange={(e) => setExperience(e.target.value)}
                placeholder="npr. Konobar u kafiću 3 godine, šanker u restoranu 1 godinu…"
              />
              <p className="mt-1 text-right text-[11px] tabular-nums text-stone-400">
                {experience.length}/{MAX_EXPERIENCE}
              </p>
            </Field>
          )}

          <Button type="submit" className="w-full" loading={working} disabled={!dirty}>
            Sačuvaj
          </Button>
        </form>
      )}
    </Card>
  )
}
