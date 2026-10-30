import { useEffect, useState } from 'react'
import { usePersistentState } from '../lib/persist'

import { useToast } from '../context/ToastContext'
import {
  DEFAULT_LAYOUT,
  FIELD_TYPES,
  SECTIONS,
  loadLayout,
  newFieldId,
  normalizeLayout,
  saveLayout,
} from '../lib/shiftForm'
import { cx, errorMessage } from '../lib/utils'
import { Button, Card, Input, Select } from './ui'

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Pomera element niza za jedno mesto (-1 gore, +1 dole). */
function moved(list, index, direction) {
  const target = index + direction
  if (target < 0 || target >= list.length) return list
  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/**
 * Izgled smene (admin): redosled delova koje radnik vidi, njihovi nazivi i
 * dodatna polja (novac, broj, tekst, da/ne) koja se pojavljuju u smeni i u
 * izveštaju.
 */
export default function ShiftFormEditor() {
  const toast = useToast()

  const [open, setOpen] = usePersistentState('formeditor.open', false)
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState('novac')

  useEffect(() => {
    loadLayout().then((l) => {
      setSaved(l)
      setDraft(l)
    })
  }, [])

  if (!draft) return null

  const dirty = !sameJson(normalizeLayout(draft), saved)
  const patch = (p) => setDraft((d) => ({ ...d, ...p }))
  const labelOf = (key) => SECTIONS.find((s) => s.key === key)?.label ?? key

  function addField(e) {
    e.preventDefault()
    const label = newLabel.trim()
    if (!label) return toast.error('Upiši naziv polja.')
    patch({ fields: [...draft.fields, { id: newFieldId(), label, type: newType, required: false }] })
    setNewLabel('')
  }

  const setField = (index, p) =>
    patch({ fields: draft.fields.map((f, i) => (i === index ? { ...f, ...p } : f)) })

  async function save() {
    setSaving(true)
    try {
      const clean = normalizeLayout(draft)
      await saveLayout(clean)
      setSaved(clean)
      setDraft(clean)
      toast.success('Izgled smene je sačuvan.')
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Nije sačuvano. Da li je puštena skripta -22?'))
    }
    setSaving(false)
  }

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
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
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold tracking-tight text-stone-900">Izgled smene</span>
          <span className="mt-0.5 block text-[13px] text-stone-500">Redosled, nazivi i dodatna polja</span>
        </span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-stone-100 p-4">
          {/* ---------- Redosled i nazivi ---------- */}
          <section>
            <h3 className="mb-1.5 text-sm font-extrabold tracking-tight text-stone-900">Redosled</h3>
            <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200">
              {draft.order.map((key, index) => {
                const meta = SECTIONS.find((s) => s.key === key)
                const hidden = draft.hidden.includes(key)
                return (
                  <li key={key} className={cx('flex items-center gap-2 px-2.5 py-2', hidden && 'opacity-50')}>
                    <div className="flex shrink-0 flex-col">
                      <button
                        type="button"
                        onClick={() => patch({ order: moved(draft.order, index, -1) })}
                        disabled={index === 0}
                        aria-label={`Pomeri ${labelOf(key)} gore`}
                        className="px-1 text-xs leading-none text-stone-400 transition hover:text-stone-800 disabled:opacity-25"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => patch({ order: moved(draft.order, index, 1) })}
                        disabled={index === draft.order.length - 1}
                        aria-label={`Pomeri ${labelOf(key)} dole`}
                        className="px-1 text-xs leading-none text-stone-400 transition hover:text-stone-800 disabled:opacity-25"
                      >
                        ▼
                      </button>
                    </div>

                    <Input
                      value={draft.titles[key] ?? ''}
                      onChange={(e) => patch({ titles: { ...draft.titles, [key]: e.target.value } })}
                      placeholder={labelOf(key)}
                      aria-label={`Naziv: ${labelOf(key)}`}
                      className="min-w-0 flex-1"
                    />

                    {meta?.canHide ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        onClick={() =>
                          patch({
                            hidden: hidden ? draft.hidden.filter((k) => k !== key) : [...draft.hidden, key],
                          })
                        }
                      >
                        {hidden ? 'Prikaži' : 'Sakrij'}
                      </Button>
                    ) : (
                      <span className="w-[64px] shrink-0 text-center text-[11px] text-stone-300">obavezno</span>
                    )}
                  </li>
                )
              })}
            </ul>
            <p className="mt-1.5 text-[11px] text-stone-400">
              Strelicama menjaš redosled. Ako ostaviš naziv praznim, važi početni.
            </p>
          </section>

          {/* ---------- Dodatna polja ---------- */}
          <section>
            <h3 className="mb-1.5 text-sm font-extrabold tracking-tight text-stone-900">Dodatna polja</h3>

            <form onSubmit={addField} className="flex flex-wrap gap-2">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="npr. Dostava, Troškovi, Zatvorena terasa"
                aria-label="Naziv novog polja"
                className="min-w-[180px] flex-1"
              />
              <Select value={newType} onChange={(e) => setNewType(e.target.value)} aria-label="Vrsta polja" className="w-32">
                {FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <Button type="submit" className="shrink-0">
                + Dodaj
              </Button>
            </form>

            {draft.fields.length === 0 ? (
              <p className="mt-2 text-sm text-stone-400">Još nema dodatnih polja.</p>
            ) : (
              <ul className="mt-2 divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200">
                {draft.fields.map((f, index) => (
                  <li key={f.id} className="space-y-2 px-2.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex shrink-0 flex-col">
                        <button
                          type="button"
                          onClick={() => patch({ fields: moved(draft.fields, index, -1) })}
                          disabled={index === 0}
                          aria-label={`Pomeri ${f.label} gore`}
                          className="px-1 text-xs leading-none text-stone-400 transition hover:text-stone-800 disabled:opacity-25"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          onClick={() => patch({ fields: moved(draft.fields, index, 1) })}
                          disabled={index === draft.fields.length - 1}
                          aria-label={`Pomeri ${f.label} dole`}
                          className="px-1 text-xs leading-none text-stone-400 transition hover:text-stone-800 disabled:opacity-25"
                        >
                          ▼
                        </button>
                      </div>
                      <Input
                        value={f.label}
                        onChange={(e) => setField(index, { label: e.target.value })}
                        aria-label="Naziv polja"
                        className="min-w-0 flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => patch({ fields: draft.fields.filter((_, i) => i !== index) })}
                        aria-label={`Obriši polje ${f.label}`}
                        className="shrink-0 rounded-md px-1.5 text-base leading-none text-stone-400 transition hover:bg-rose-50 hover:text-rose-600"
                      >
                        ×
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pl-7">
                      <Select
                        value={f.type}
                        onChange={(e) => setField(index, { type: e.target.value })}
                        aria-label="Vrsta polja"
                        className="w-32"
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </Select>
                      {f.type !== 'da_ne' && (
                        <button
                          type="button"
                          onClick={() => setField(index, { required: !f.required })}
                          aria-pressed={f.required}
                          className={cx(
                            'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                            f.required ? 'bg-ink text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200',
                          )}
                        >
                          {f.required ? 'Obavezno' : 'Nije obavezno'}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-[11px] text-stone-400">
              Ova polja radnik vidi u smeni u delu „Dodatno“, a upisano se vidi u izveštaju. Brisanjem polja
              stari izveštaji ne gube ono što je već upisano.
            </p>
          </section>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={saving}
              onClick={() => setDraft(normalizeLayout(DEFAULT_LAYOUT))}
            >
              Vrati početno
            </Button>
            <Button className="flex-1" loading={saving} disabled={!dirty} onClick={save}>
              Sačuvaj
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
