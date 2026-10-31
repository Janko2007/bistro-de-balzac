import { useCallback, useEffect, useRef, useState } from 'react'
import { usePersistentState } from '../lib/persist'

import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import {
  EFFECTS,
  KINDS,
  createAnnouncement,
  loadAll,
  loadReadCounts,
  removeAnnouncement,
  uploadImage,
} from '../lib/announcements'
import { cx, errorMessage, formatDate, formatMoney, parseNumber } from '../lib/utils'
import AnnouncementPopup from './AnnouncementPopup'
import { composeBody } from './RichText'
import { Button, Card, Field, Input, Modal, MoneyInput, Select, Textarea } from './ui'

const SEND_KINDS = ['poruka', 'slavlje', 'dnevnica']

const EMPTY = {
  kind: 'poruka',
  target: '', // '' = svima
  title: '',
  subtitle: '',
  body: '',
  icon: '',
  effect: 'bez',
  amount: '',
  saveWage: false,
  file: null,
}

/**
 * Obaveštenja (admin) — šalješ poruku, sliku, slavlje ili povećanje dnevnice.
 *
 * Svima ili jednoj osobi. Radnik ga vidi jednom čim otvori aplikaciju, a
 * ostaje sačuvano u njegovom Profilu. Bedž i radnik meseca šalju se sami.
 */
export default function AnnouncementAdmin({ people }) {
  const { profile } = useAuth()
  const toast = useToast()

  const [open, setOpen] = usePersistentState('annadmin.open', false)
  const [items, setItems] = useState([])
  const [reads, setReads] = useState(new Map())
  const [form, setForm] = useState(null)
  const [working, setWorking] = useState(false)
  const [toRemove, setToRemove] = useState(null)
  const [preview, setPreview] = useState(null)
  const fileRef = useRef(null)
  const bodyRef = useRef(null)

  const load = useCallback(async () => {
    const [list, counts] = await Promise.all([loadAll(), loadReadCounts()])
    setItems(list)
    setReads(counts)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const nameOf = (id) => people.find((p) => p.id === id)?.full_name ?? 'Radnik'
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const workers = people.filter((p) => p.is_active)

  function openNew(kind = 'poruka') {
    setForm({ ...EMPTY, kind, effect: kind === 'slavlje' ? 'konfete' : 'bez' })
  }

  /* B: označeni tekst se uvija u **…** (ponovnim klikom se skida). */
  function boldSelection() {
    const el = bodyRef.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b, value } = el
    if (a === b) return toast.error('Prvo označi reči koje hoćeš da podebljaš.')
    const picked = value.slice(a, b)
    const wrapped = picked.startsWith('**') && picked.endsWith('**') && picked.length > 4
    const next = wrapped
      ? value.slice(0, a) + picked.slice(2, -2) + value.slice(b)
      : value.slice(0, a) + `**${picked}**` + value.slice(b)
    set({ body: next })
    const end = wrapped ? b - 4 : b + 4
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(a, end)
    })
  }

  /* Pregled: isti prozor kao kod radnika, ali ništa se ne šalje ni ne čuva. */
  function openPreview() {
    const f = form
    let title = f.title.trim()
    let main = f.body.trim()
    if (f.kind === 'dnevnica') {
      const amount = parseNumber(f.amount)
      if (!title) title = 'Povećanje dnevnice'
      if (!main) main = `Tvoja dnevnica je povećana na ${formatMoney(amount)}. Hvala na trudu!`
    }
    const body = composeBody(f.subtitle, main)
    const photo = f.file ? URL.createObjectURL(f.file) : null
    setPreview({
      item: {
        id: `pregled-${Date.now()}`,
        title,
        body,
        icon: '',
        effect: f.effect,
      },
      photo,
      heading: null,
    })
  }

  function closePreview() {
    if (preview?.photo) URL.revokeObjectURL(preview.photo)
    setPreview(null)
  }

  async function send(e) {
    e.preventDefault()
    const f = form

    if (f.kind === 'dnevnica') {
      if (!f.target) return toast.error('Izaberi radnika kome se menja dnevnica.')
      if (parseNumber(f.amount) <= 0) return toast.error('Unesi novi iznos dnevnice.')
    }
    if (f.kind !== 'dnevnica' && !f.title.trim() && !f.subtitle.trim() && !f.body.trim() && !f.file) {
      return toast.error('Napiši bar naslov, poruku ili dodaj sliku.')
    }

    setWorking(true)
    try {
      const amount = parseNumber(f.amount)
      let title = f.title.trim()
      let main = f.body.trim()

      if (f.kind === 'dnevnica') {
        if (!title) title = 'Povećanje dnevnice'
        if (!main) main = `Tvoja dnevnica je povećana na ${formatMoney(amount)}. Hvala na trudu!`
      }
      const body = composeBody(f.subtitle, main)

      const image_path = f.file ? await uploadImage(f.file) : null

      await createAnnouncement(
        {
          kind: f.kind,
          title,
          body,
          icon: '',
          image_path,
          effect: f.effect,
          target_profile_id: f.target || null,
          subject_id: f.target || null,
        },
        profile.id,
      )

      // Dnevnica se menja u profilu samo ako je admin to izričito označio.
      if (f.kind === 'dnevnica' && f.saveWage) {
        const { error } = await supabase
          .from('profiles')
          .update({ daily_wage: amount })
          .eq('id', f.target)
        if (error) throw error
      }

      toast.success(f.target ? `Poslato: ${nameOf(f.target)}.` : 'Poslato svima.')
      setForm(null)
      load()
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Obaveštenje nije poslato. Da li je puštena skripta -20?'))
    }
    setWorking(false)
  }

  async function remove(item) {
    setWorking(true)
    try {
      await removeAnnouncement(item)
      toast.success('Obaveštenje je obrisano.')
      load()
    } catch (err) {
      toast.error(errorMessage(err))
    }
    setWorking(false)
    setToRemove(null)
  }

  return (
    <>
      <Card>
        <div className={cx('flex items-center gap-2 pr-3 transition', open ? 'bg-stone-100' : 'hover:bg-stone-50')}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-2.5 px-4 py-3.5 text-left"
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
              Obaveštenja
            </span>
            <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-bold tabular-nums text-stone-500">
              {items.length}
            </span>
          </button>
          {open && (
            <Button size="sm" className="shrink-0" onClick={() => openNew()}>
              + Novo
            </Button>
          )}
        </div>

        {open && (
          <div className="border-t border-stone-100">
            {/* Prečice — jedan klik do najčešćeg. */}
            <div className="flex flex-wrap gap-1.5 px-4 py-3">
              {SEND_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => openNew(k)}
                  className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-200"
                >
                  {KINDS[k].label}
                </button>
              ))}
            </div>

            {items.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-stone-400">Još ništa nije poslato.</p>
            ) : (
              <ul className="divide-y divide-stone-100 border-t border-stone-100">
                {items.map((a) => (
                  <li key={a.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-stone-900">
                          {a.title || 'Obaveštenje'}
                        </span>
                        <span className="block truncate text-[11px] text-stone-400">
                          {formatDate(a.created_at.slice(0, 10))} ·{' '}
                          {a.target_profile_id ? nameOf(a.target_profile_id) : 'svi'} · video{' '}
                          {reads.get(a.id) ?? 0}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setToRemove((id) => (id === a.id ? null : a.id))}
                        aria-label="Obriši obaveštenje"
                        className="shrink-0 rounded-md px-1.5 text-base leading-none text-stone-400 transition hover:bg-rose-50 hover:text-rose-600"
                      >
                        ×
                      </button>
                    </div>
                    {toRemove === a.id && (
                      <div className="mt-2 rounded-lg bg-rose-50 p-2.5 ring-1 ring-inset ring-rose-200">
                        <p className="text-xs font-bold text-rose-900">Obrisati obaveštenje?</p>
                        <p className="mt-0.5 text-[11px] text-rose-800">
                          Nestaje i iz Profila onih koji su ga primili.
                        </p>
                        <div className="mt-2 flex justify-end gap-2">
                          <Button variant="secondary" size="sm" onClick={() => setToRemove(null)}>
                            Ne
                          </Button>
                          <Button variant="danger" size="sm" loading={working} onClick={() => remove(a)}>
                            Da, obriši
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Modal open={form !== null} onClose={() => !working && setForm(null)} title="Novo obaveštenje" size="md">
        {form && (
          <form onSubmit={send} className="space-y-4">
            {/* Vrsta */}
            <div className="grid grid-cols-3 gap-1.5">
              {SEND_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() =>
                    set({
                      kind: k,
                      effect: k === 'slavlje' && form.effect === 'bez' ? 'konfete' : form.effect,
                    })
                  }
                  aria-pressed={form.kind === k}
                  className={cx(
                    'rounded-2xl px-2 py-2.5 text-[13px] font-semibold transition',
                    form.kind === k ? 'bg-ink text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70',
                  )}
                >
                  {KINDS[k].label}
                </button>
              ))}
            </div>

            <Field label="Kome" hint={form.kind === 'dnevnica' ? 'Dnevnica ide jednoj osobi.' : 'Svima ili samo jednoj osobi.'}>
              <Select value={form.target} onChange={(e) => set({ target: e.target.value })}>
                {form.kind !== 'dnevnica' && <option value="">Svima</option>}
                {form.kind === 'dnevnica' && <option value="">Izaberi…</option>}
                {workers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </Select>
            </Field>

            {form.kind === 'dnevnica' && (
              <>
                <Field label="Nova dnevnica">
                  <MoneyInput value={form.amount} onChange={(v) => set({ amount: v })} />
                </Field>
                <button
                  type="button"
                  onClick={() => set({ saveWage: !form.saveWage })}
                  aria-pressed={form.saveWage}
                  className="flex w-full items-center gap-3 rounded-2xl bg-stone-100 px-3.5 py-3 text-left"
                >
                  <span
                    className={cx(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold',
                      form.saveWage ? 'bg-brand-600 text-white' : 'bg-white text-transparent ring-1 ring-inset ring-stone-300',
                    )}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  <span className="text-sm font-semibold text-stone-800">
                    Ujedno upiši novu dnevnicu u profil radnika
                  </span>
                </button>
              </>
            )}

            <Field label="Naslov" hint={form.kind === 'dnevnica' ? 'Prazno = „Povećanje dnevnice“.' : undefined}>
              <Input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="npr. Sjajna večeras!" />
            </Field>

            <Field label="Podnaslov" hint="Opciono — manji red ispod naslova.">
              <Input value={form.subtitle} onChange={(e) => set({ subtitle: e.target.value })} placeholder="npr. Za sve koji rade vikendom" />
            </Field>

            <div>
              <span className="label">Tekst</span>
              <div className="mb-1.5 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={boldSelection}
                  aria-label="Podebljaj označeni tekst"
                  title="Podebljaj označeni tekst"
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-stone-100 text-[15px] font-black text-stone-800 transition hover:bg-stone-200 active:scale-95"
                >
                  B
                </button>
                <span className="text-[11px] text-stone-400">Označi reči pa klikni B</span>
              </div>
              <Textarea
                ref={bodyRef}
                rows={6}
                value={form.body}
                onChange={(e) => set({ body: e.target.value })}
                placeholder={form.kind === 'dnevnica' ? 'Prazno = automatski tekst' : 'Šta želiš da im kažeš…'}
              />
            </div>

            {/* Slika */}
            <div>
              <span className="label">Slika</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => set({ file: e.target.files?.[0] ?? null })}
              />
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                  {form.file ? 'Druga slika' : 'Dodaj sliku'}
                </Button>
                {form.file && (
                  <>
                    <span className="min-w-0 flex-1 truncate text-xs text-stone-500">{form.file.name}</span>
                    <button
                      type="button"
                      onClick={() => set({ file: null })}
                      className="px-1.5 text-base leading-none text-stone-400 hover:text-rose-600"
                      aria-label="Ukloni sliku"
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Efekat */}
            <div>
              <span className="label">Efekat</span>
              <div className="grid grid-cols-3 gap-1.5">
                {EFFECTS.map((ef) => (
                  <button
                    key={ef.value}
                    type="button"
                    onClick={() => set({ effect: ef.value })}
                    aria-pressed={form.effect === ef.value}
                    className={cx(
                      'rounded-2xl px-2 py-2.5 text-[13px] font-semibold transition',
                      form.effect === ef.value ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200/70',
                    )}
                  >
                    {ef.label}
                  </button>
                ))}
              </div>
            </div>


            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" variant="secondary" className="flex-1" disabled={working} onClick={() => setForm(null)}>
                Otkaži
              </Button>
              <Button type="button" variant="secondary" className="flex-1" disabled={working} onClick={openPreview}>
                Pregled
              </Button>
              <Button type="submit" className="w-full" loading={working}>
                Pošalji
              </Button>
            </div>
          </form>
        )}
      </Modal>
      {preview && (
        <AnnouncementPopup
          item={preview.item}
          photo={preview.photo}
          hasImage={Boolean(preview.photo)}
          counter="pregled"
          buttonLabel="Zatvori pregled"
          onDismiss={closePreview}
        />
      )}
    </>
  )
}
