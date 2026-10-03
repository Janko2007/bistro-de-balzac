import { useState } from 'react'

import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { Button, Field, Input, Modal } from './ui'
import { nextCountOn } from '../lib/categories'
import { countLabel, cx, errorMessage, formatDate } from '../lib/utils'

/**
 * Upravljanje kategorijama (samo admin).
 * Redosled ovde je redosled kojim radnik vidi kategorije u popisu.
 */
export default function CategoryManager({ open, onClose, categories, items, onChanged }) {
  const toast = useToast()

  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null) // { id, name }
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [counting, setCounting] = useState(null) // { id, name, days }
  const [working, setWorking] = useState(false)

  const countIn = (categoryName) => items.filter((i) => i.category === categoryName).length

  async function addCategory(e) {
    e.preventDefault()
    const value = name.trim()
    if (!value) return toast.error('Unesi naziv kategorije.')

    setWorking(true)
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sort_order), 0)
    const { error } = await supabase
      .from('categories')
      .insert({ name: value, sort_order: maxOrder + 100 })
    setWorking(false)

    if (error) {
      toast.error(
        error.code === '23505' ? 'Ta kategorija već postoji.' : errorMessage(error),
      )
      return
    }
    setName('')
    toast.success(`Kategorija „${value}" je dodata.`)
    onChanged()
  }

  async function saveRename() {
    const value = editing.name.trim()
    if (!value) return toast.error('Naziv ne može biti prazan.')

    setWorking(true)
    // Funkcija u bazi menja i kategoriju i sve njene artikle odjednom.
    const { error } = await supabase.rpc('rename_category', {
      p_id: editing.id,
      p_name: value,
    })
    setWorking(false)

    if (error) {
      toast.error(
        error.code === '23505' ? 'Kategorija sa tim nazivom već postoji.' : errorMessage(error),
      )
      return
    }
    setEditing(null)
    toast.success('Kategorija je preimenovana.')
    onChanged()
  }

  /**
   * Sakriva ili vraća celu grupu. Sakrivena se ne prikazuje radnicima u
   * popisu, ali artikli i stari izveštaji ostaju netaknuti.
   */
  async function toggleActive(category) {
    setWorking(true)
    const { error } = await supabase
      .from('categories')
      .update({ is_active: !category.is_active })
      .eq('id', category.id)
    setWorking(false)

    if (error) return toast.error(errorMessage(error))
    toast.success(
      category.is_active
        ? `„${category.name}“ je sakrivena iz popisa.`
        : `„${category.name}“ je vraćena u popis.`,
    )
    onChanged()
  }

  /**
   * Na koliko dana se grupa popisuje. 0 znači svaku smenu (obično).
   * Žestine stoje na 7 — dotle se radnicima početno stanje samo prepisuje.
   */
  async function saveCountEvery() {
    const days = Math.max(0, Math.round(Number(counting.days) || 0))

    setWorking(true)
    const { error } = await supabase
      .from('categories')
      .update({ count_every_days: days })
      .eq('id', counting.id)
    setWorking(false)

    if (error) return toast.error(errorMessage(error))
    setCounting(null)
    toast.success(
      days > 0
        ? `„${counting.name}“ se popisuje na svakih ${days} dana.`
        : `„${counting.name}“ se popisuje svaku smenu.`,
    )
    onChanged()
  }

  /** Popis van reda — sledeća smena mora da izmeri ovu grupu. */
  async function requestCount(category) {
    setWorking(true)
    const { error } = await supabase
      .from('categories')
      .update({ count_due: !category.count_due })
      .eq('id', category.id)
    setWorking(false)

    if (error) return toast.error(errorMessage(error))
    toast.success(
      category.count_due
        ? 'Zahtev za popis je povučen.'
        : `Sledeća smena popisuje „${category.name}“.`,
    )
    onChanged()
  }

  /** Zamenjuje mesta sa susednom kategorijom. */
  async function move(index, direction) {
    const target = index + direction
    if (target < 0 || target >= categories.length) return

    const a = categories[index]
    const b = categories[target]

    setWorking(true)
    const [res1, res2] = await Promise.all([
      supabase.from('categories').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('categories').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
    setWorking(false)

    if (res1.error || res2.error) {
      toast.error(errorMessage(res1.error || res2.error))
      return
    }
    onChanged()
  }

  async function remove(category) {
    setWorking(true)
    const { error } = await supabase.from('categories').delete().eq('id', category.id)
    setWorking(false)
    setConfirmDelete(null)

    if (error) return toast.error(errorMessage(error))
    toast.success(`Kategorija „${category.name}" je obrisana.`)
    onChanged()
  }

  return (
    <>
      <Modal open={open} onClose={() => !working && onClose()} title="Kategorije" size="md">
        <div className="space-y-4">
          <p className="text-sm text-stone-600">
            Redosled ovde je redosled kojim radnik vidi kategorije u popisu. Strelicama ih
            pomeraj gore-dole.
          </p>

          <form onSubmit={addCategory} className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="npr. Kokteli"
              aria-label="Naziv nove kategorije"
            />
            <Button type="submit" loading={working} className="shrink-0">
              + Dodaj
            </Button>
          </form>

          <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200">
            {categories.map((category, index) => {
              const used = countIn(category.name)
              return (
                <li
                  key={category.id}
                  className={cx(
                    'flex items-center gap-2 px-2.5 py-2',
                    !category.is_active && 'opacity-60',
                  )}
                >
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0 || working}
                      aria-label={`Pomeri ${category.name} gore`}
                      className="px-1 text-xs leading-none text-stone-400 transition hover:text-stone-800 disabled:opacity-25"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === categories.length - 1 || working}
                      aria-label={`Pomeri ${category.name} dole`}
                      className="px-1 text-xs leading-none text-stone-400 transition hover:text-stone-800 disabled:opacity-25"
                    >
                      ▼
                    </button>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-stone-800">
                      {category.name}
                    </p>
                    <p className="text-xs text-stone-400">
                      {countLabel(used, 'artikal')}
                      {!category.is_active && ' · sakrivena'}
                      {Number(category.count_every_days) > 0 &&
                        ` · popis na ${category.count_every_days} dana`}
                      {category.count_due && ' · popis tražen'}
                      {!category.count_due &&
                        nextCountOn(category) &&
                        ` · sledeći ${formatDate(nextCountOn(category))}`}
                    </p>
                  </div>

                  {/* Koliko često se grupa stvarno meri (žestine — na 7 dana). */}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={working}
                    onClick={() =>
                      setCounting({
                        id: category.id,
                        name: category.name,
                        days: String(category.count_every_days ?? 0),
                      })
                    }
                  >
                    Popis
                  </Button>
                  {Number(category.count_every_days) > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={working}
                      className={category.count_due ? 'text-amber-700' : undefined}
                      onClick={() => requestCount(category)}
                    >
                      {category.count_due ? 'Poništi' : 'Popiši sada'}
                    </Button>
                  )}

                  {/* Sakrivena grupa se ne vidi u popisu — artikli ostaju. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={working}
                    onClick={() => toggleActive(category)}
                  >
                    {category.is_active ? 'Sakrij' : 'Vrati'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing({ id: category.id, name: category.name })}
                  >
                    Preimenuj
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cx(used > 0 ? 'text-stone-300' : 'text-rose-600')}
                    disabled={used > 0}
                    title={used > 0 ? 'Prvo premesti artikle u drugu kategoriju' : undefined}
                    onClick={() => setConfirmDelete(category)}
                  >
                    Obriši
                  </Button>
                </li>
              )
            })}

            {categories.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-stone-500">
                Još nema kategorija. Dodaj prvu iznad.
              </li>
            )}
          </ul>

          <Button variant="secondary" className="w-full" onClick={onClose}>
            Zatvori
          </Button>
        </div>
      </Modal>

      {/* ---------- Preimenovanje ---------- */}
      <Modal
        open={Boolean(editing)}
        onClose={() => !working && setEditing(null)}
        title="Preimenuj kategoriju"
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setEditing(null)}>
              Otkaži
            </Button>
            <Button className="flex-1" loading={working} onClick={saveRename}>
              Sačuvaj
            </Button>
          </div>
        }
      >
        <Field
          label="Novi naziv"
          hint="Svi artikli iz ove kategorije automatski prelaze na novi naziv."
        >
          <Input
            value={editing?.name ?? ''}
            onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))}
            autoFocus
          />
        </Field>
      </Modal>

      {/* ---------- Na koliko dana se popisuje ---------- */}
      <Modal
        open={Boolean(counting)}
        onClose={() => !working && setCounting(null)}
        title={`Popis — ${counting?.name ?? ''}`}
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setCounting(null)}>
              Otkaži
            </Button>
            <Button className="flex-1" loading={working} onClick={saveCountEvery}>
              Sačuvaj
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field
            label="Popisuje se na svakih (dana)"
            hint="0 = popisuje se svaku smenu. Za žestine upiši 7."
          >
            <Input
              type="number"
              min="0"
              max="90"
              value={counting?.days ?? '0'}
              onChange={(e) => setCounting((c) => ({ ...c, days: e.target.value }))}
              autoFocus
            />
          </Field>

          <div className="flex flex-wrap gap-1.5">
            {[0, 7, 14, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setCounting((c) => ({ ...c, days: String(d) }))}
                className={cx(
                  'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                  String(d) === String(counting?.days)
                    ? 'bg-ink text-white'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200',
                )}
              >
                {d === 0 ? 'Svaku smenu' : `${d} dana`}
              </button>
            ))}
          </div>

          <p className="rounded-xl bg-stone-100 px-3.5 py-2.5 text-xs leading-relaxed text-stone-600">
            Dok ne dođe red za popis, radniku se početno stanje prepisuje iz prošle smene — on
            upisuje samo prodato, a krajnje ide sledećoj smeni. Dugmetom <b>Popiši sada</b> tražiš
            popis i ranije.
          </p>
        </div>
      </Modal>

      {/* ---------- Brisanje ---------- */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Obriši kategoriju"
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(null)}>
              Otkaži
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              loading={working}
              onClick={() => remove(confirmDelete)}
            >
              Obriši
            </Button>
          </div>
        }
      >
        <p className="text-sm text-stone-600">
          Kategorija <strong>{confirmDelete?.name}</strong> je prazna i može da se obriše. Stari
          izveštaji koji je pominju ostaju netaknuti.
        </p>
      </Modal>
    </>
  )
}
