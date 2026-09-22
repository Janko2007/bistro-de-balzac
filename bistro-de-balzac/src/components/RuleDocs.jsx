import { useCallback, useEffect, useState } from 'react'

import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { cx, errorMessage, formatDateTime } from '../lib/utils'
import RuleText from './RuleText'
import { Button, Card, CardHeader, Field, Input, Modal, Textarea } from './ui'

/**
 * Pravila i obaveze — pravilnik, dnevne obaveze, obaveze šankera i konobara.
 *
 * Svaki dokument se otvara klikom, kao kategorije u popisu.
 * Radnik ih samo čita (ekran Dnevnice). Sa `editable` vlasnik može da ih
 * menja, dodaje nove, briše i menja im redosled (ekran Radnici).
 */
export default function RuleDocs({ editable = false }) {
  const toast = useToast()

  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(() => new Set())

  const [edit, setEdit] = useState(null) // { id?, title, body }
  const [removing, setRemoving] = useState(null) // dokument koji se briše
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('rule_docs')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) toast.error(errorMessage(error, 'Ne mogu da učitam pravila.'))
    setDocs(data ?? [])
    setLoading(false)
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  function toggle(id) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /* ---------------------------------------------------------------- */
  /*  Vlasnik: upis, brisanje, redosled                                */
  /* ---------------------------------------------------------------- */
  async function save(e) {
    e.preventDefault()
    const title = edit.title.trim()
    if (!title) return toast.error('Unesi naslov.')

    setWorking(true)
    const payload = { title, body: edit.body.replace(/\s+$/, '') }

    const { data, error } = edit.id
      ? await supabase.from('rule_docs').update(payload).eq('id', edit.id).select('id').single()
      : await supabase
          .from('rule_docs')
          .insert({
            ...payload,
            // Novi dokument ide na kraj spiska.
            sort_order: (docs.at(-1)?.sort_order ?? 0) + 100,
          })
          .select('id')
          .single()
    setWorking(false)

    if (error) return toast.error(errorMessage(error))

    toast.success(edit.id ? 'Izmene su sačuvane.' : 'Dokument je dodat.')
    setOpen((prev) => new Set(prev).add(data.id))
    setEdit(null)
    load()
  }

  async function remove() {
    setWorking(true)
    const { error } = await supabase.from('rule_docs').delete().eq('id', removing.id)
    setWorking(false)

    if (error) return toast.error(errorMessage(error))
    toast.success(`„${removing.title}“ je obrisan.`)
    setRemoving(null)
    load()
  }

  /** Zamena mesta sa susedom iznad (-1) ili ispod (+1). */
  async function move(index, dir) {
    const a = docs[index]
    const b = docs[index + dir]
    if (!a || !b) return

    // Odmah na ekranu, pa u bazu.
    const next = [...docs]
    next[index] = { ...b, sort_order: a.sort_order }
    next[index + dir] = { ...a, sort_order: b.sort_order }
    setDocs(next)

    const [r1, r2] = await Promise.all([
      supabase.from('rule_docs').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('rule_docs').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
    if (r1.error || r2.error) {
      toast.error(errorMessage(r1.error || r2.error))
      load()
    }
  }

  if (loading) return null
  if (!editable && docs.length === 0) return null

  return (
    <>
      <Card>
        <CardHeader
          title="Pravila i obaveze"
          subtitle={editable ? 'Radnici ovo vide na ekranu Profil' : undefined}
          action={
            editable ? (
              <Button
                size="sm"
                className="shrink-0"
                onClick={() => setEdit({ title: '', body: '' })}
              >
                + Novi
              </Button>
            ) : null
          }
        />

        {docs.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-stone-500">
            Još nema dokumenata. Klikni „+ Novi“ da dodaš prvi.
          </p>
        ) : (
          <div className="divide-y divide-stone-100">
            {docs.map((doc, index) => {
              const isOpen = open.has(doc.id)
              return (
                <div key={doc.id}>
                  <button
                    type="button"
                    onClick={() => toggle(doc.id)}
                    aria-expanded={isOpen}
                    className={cx(
                      'flex w-full items-center gap-2.5 px-4 py-3 text-left transition',
                      isOpen ? 'bg-stone-100' : 'bg-stone-50 hover:bg-stone-100',
                    )}
                  >
                    <svg
                      className={cx(
                        'h-4 w-4 shrink-0 text-stone-400 transition-transform',
                        isOpen && 'rotate-90',
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
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-800">
                      {doc.title}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-4 py-3.5">
                      <RuleText body={doc.body} />

                      {editable && (
                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              setEdit({ id: doc.id, title: doc.title, body: doc.body })
                            }
                          >
                            Izmeni
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                            aria-label="Pomeri gore"
                          >
                            ▲
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={index === docs.length - 1}
                            onClick={() => move(index, 1)}
                            aria-label="Pomeri dole"
                          >
                            ▼
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ml-auto text-rose-600"
                            onClick={() => setRemoving(doc)}
                          >
                            Obriši
                          </Button>
                          <p className="w-full text-[11px] text-stone-400">
                            Poslednja izmena {formatDateTime(doc.updated_at)}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* ---------- Izmena / novi dokument ---------- */}
      <Modal
        open={!!edit}
        onClose={() => !working && setEdit(null)}
        title={edit?.id ? 'Izmeni dokument' : 'Novi dokument'}
        size="lg"
      >
        {edit && (
          <form onSubmit={save} className="space-y-4">
            <Field label="Naslov" required>
              <Input
                value={edit.title}
                onChange={(e) => setEdit((d) => ({ ...d, title: e.target.value }))}
                placeholder="npr. Obaveze šankera"
                autoFocus={!edit.id}
              />
            </Field>

            <Field label="Tekst">
              <Textarea
                rows={16}
                value={edit.body}
                onChange={(e) => setEdit((d) => ({ ...d, body: e.target.value }))}
                placeholder={'# Naslov\n- stavka\n- stavka\n! Upozorenje'}
                className="text-[14px] leading-relaxed"
              />
            </Field>

            <div className="rounded-xl bg-stone-100 px-3.5 py-2.5 text-xs text-stone-600">
              <p className="font-semibold text-stone-700">Kako se piše</p>
              <p className="mt-1">
                <code className="font-bold">#</code> na početku reda — naslov ·{' '}
                <code className="font-bold">-</code> — stavka sa tačkom ·{' '}
                <code className="font-bold">!</code> — upozorenje (žuto) ·{' '}
                <code className="font-bold">!!</code> — <span className="text-rose-700">crveni tekst</span>
              </p>
              <p className="mt-0.5">
                Naslov koji se zove kao dan u nedelji (npr. <code>#&nbsp;Utorak</code>) radnicima
                se tog dana označi sa <b>danas</b>.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                disabled={working}
                onClick={() => setEdit(null)}
              >
                Otkaži
              </Button>
              <Button type="submit" className="flex-1" loading={working}>
                Sačuvaj
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ---------- Brisanje ---------- */}
      <Modal
        open={!!removing}
        onClose={() => !working && setRemoving(null)}
        title="Obriši dokument"
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={working}
              onClick={() => setRemoving(null)}
            >
              Otkaži
            </Button>
            <Button variant="danger" className="flex-1" loading={working} onClick={remove}>
              Obriši
            </Button>
          </div>
        }
      >
        <p className="text-sm text-stone-600">
          <strong>{removing?.title}</strong> se briše i radnici ga više neće videti. Ova radnja se
          ne može poništiti.
        </p>
      </Modal>
    </>
  )
}
