import { useState } from 'react'

import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { Button, Field, Input, Modal } from './ui'
import { countLabel, cx, errorMessage } from '../lib/utils'

/**
 * Upravljanje kategorijama (samo vlasnik).
 * Redosled ovde je redosled kojim radnik vidi kategorije u popisu.
 */
export default function CategoryManager({ open, onClose, categories, items, onChanged }) {
  const toast = useToast()

  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null) // { id, name }
  const [confirmDelete, setConfirmDelete] = useState(null)
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
          <p className="text-sm text-slate-600">
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

          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {categories.map((category, index) => {
              const used = countIn(category.name)
              return (
                <li key={category.id} className="flex items-center gap-2 px-2.5 py-2">
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0 || working}
                      aria-label={`Pomeri ${category.name} gore`}
                      className="px-1 text-xs leading-none text-slate-400 transition hover:text-slate-800 disabled:opacity-25"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === categories.length - 1 || working}
                      aria-label={`Pomeri ${category.name} dole`}
                      className="px-1 text-xs leading-none text-slate-400 transition hover:text-slate-800 disabled:opacity-25"
                    >
                      ▼
                    </button>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {category.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {countLabel(used, 'artikal')}
                    </p>
                  </div>

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
                    className={cx(used > 0 ? 'text-slate-300' : 'text-rose-600')}
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
              <li className="px-4 py-8 text-center text-sm text-slate-500">
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
        <p className="text-sm text-slate-600">
          Kategorija <strong>{confirmDelete?.name}</strong> je prazna i može da se obriše. Stari
          izveštaji koji je pominju ostaju netaknuti.
        </p>
      </Modal>
    </>
  )
}
