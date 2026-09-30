import { useCallback, useEffect, useMemo, useState } from 'react'

import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabaseClient'
import { categoryComparator, loadCategories } from '../lib/categories'
import CategoryManager from '../components/CategoryManager'
import ItemSalesReport from '../components/ItemSalesReport'
import { blankFields, heading, printDocument, table } from '../lib/print'
import ReportPicker from '../components/ReportPicker'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CategoryToggle,
  EmptyState,
  Field,
  FullPageLoader,
  Input,
  Modal,
  Select,
} from '../components/ui'
import { countLabel, cx, errorMessage } from '../lib/utils'

const UNITS = ['kom', 'flaša', 'lim', 'l', 'ml', 'kg', 'g', 'gajba', 'paklo']

const emptyForm = {
  id: null,
  name: '',
  category: '',
  unit: 'kom',
  sort_order: 100,
  is_active: true,
  is_counter: false,
}

export default function AdminItems() {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [catManagerOpen, setCatManagerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  // Kartica „Artikli“ je zatvorena dok se ne klikne na naslov.
  const [listOpen, setListOpen] = useState(false)
  const [openCats, setOpenCats] = useState(() => new Set())

  const [pickerOpen, setPickerOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const load = useCallback(async () => {
    const [itemsRes, cats] = await Promise.all([
      supabase.from('items').select('*').order('sort_order'),
      loadCategories().catch((err) => {
        toast.error(errorMessage(err))
        return []
      }),
    ])

    if (itemsRes.error) toast.error(errorMessage(itemsRes.error))
    else setItems(itemsRes.data ?? [])
    setCategories(cats)
    setLoading(false)
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const catNames = useMemo(() => categories.map((c) => c.name), [categories])
  const compareCats = useMemo(() => categoryComparator(categories), [categories])

  /* Kategorije su zatvorene dok se ne kliknu; pretraga ih privremeno otvara. */
  const searching = search.trim() !== ''
  const isCatOpen = (category) => searching || openCats.has(category)

  function toggleCat(category) {
    setOpenCats((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  /** Traženi pojam — isti filter za aktivne i za isključene. */
  const matches = useCallback(
    (item) => {
      const term = search.trim().toLowerCase()
      if (!term) return true
      return (
        item.name.toLowerCase().includes(term) || item.category.toLowerCase().includes(term)
      )
    },
    [search],
  )

  const grouped = useMemo(() => {
    const map = new Map()
    for (const item of items.filter((i) => i.is_active && matches(i))) {
      if (!map.has(item.category)) map.set(item.category, [])
      map.get(item.category).push(item)
    }
    // Redosled kategorija je onaj koji je admin podesio.
    return Array.from(map.entries()).sort((a, b) => compareCats(a[0], b[0]))
  }, [items, matches, compareCats])

  /* Isključeni artikli ne stoje među aktivnima — sklonjeni su na dno, iza
     dugmeta, odakle se jednim klikom vraćaju u popis. */
  const inactiveItems = useMemo(
    () => items.filter((i) => !i.is_active && matches(i)),
    [items, matches],
  )

  /** Aktivni artikli po kategorijama — osnova za obrazac koji se štampa. */
  const printableGroups = useMemo(() => {
    const map = new Map()
    for (const item of items.filter((i) => i.is_active)) {
      if (!map.has(item.category)) map.set(item.category, [])
      map.get(item.category).push(item)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'sr'))
    }
    return Array.from(map.entries()).sort((a, b) => compareCats(a[0], b[0]))
  }, [items, compareCats])

  /**
   * Popis za štampu — prazan obrazac za ručno popunjavanje (rezerva kad
   * telefon ostane bez baterije ili neta). `chosenCats` bira kategorije.
   */
  function printPopis(chosenCats) {
    const columns = [
      { label: 'Artikal' },
      { label: 'Jed.', width: '9%' },
      { label: 'Početno', align: 'right', width: '13%' },
      { label: 'Dodato', align: 'right', width: '13%' },
      { label: 'Prodato', align: 'right', width: '13%' },
      { label: 'Krajnje', align: 'right', width: '13%' },
    ]

    // Pretraga na ekranu ne skraćuje popis — štampa se ono što je označeno.
    const groups = printableGroups.filter(([category]) => chosenCats.includes(category))

    const rows = []
    let count = 0
    for (const [category, catItems] of groups) {
      rows.push({ kind: 'group', label: category, right: String(catItems.length) })
      for (const item of catItems) {
        count += 1
        rows.push({ cells: [item.name, item.unit, '', '', '', ''] })
      }
    }

    printDocument({
      title: 'Popis artikala',
      subtitle: 'Obrazac za ručni popis — upisuje se početno stanje, dodato i prodato',
      meta: [{ label: 'Artikala', value: String(count) }],
      // Viši redovi i tanka linija u praznim poljima — da ima gde da se piše.
      // Viši redovi, linija za pisanje i uspravne crte — da se vidi gde ide
      // koji broj kad se popis popunjava rukom.
      extraCss: `
        table.t td { height: 26px; }
        table.t tr:not(.g) td:empty { border-bottom: 1px solid #b9b3ad; }
        table.t th + th, table.t tr:not(.g) td + td { border-left: 1px solid #e7e5e4; }
        table.t tr.g td { height: auto; }
      `,
      content: [
        blankFields(['Datum', 'Smena', 'Radnik', 'Potpis']),
        heading('Artikli po kategorijama'),
        table({ columns, rows, empty: 'Nema aktivnih artikala.' }),
      ].join(''),
    })
  }

  function openNew() {
    const maxSort = items.reduce((m, i) => Math.max(m, i.sort_order), 0)
    setForm({ ...emptyForm, sort_order: maxSort + 10, category: catNames[0] ?? 'Ostalo' })
    setModalOpen(true)
  }

  function openEdit(item) {
    setForm({
      id: item.id,
      name: item.name,
      category: item.category,
      unit: item.unit,
      sort_order: item.sort_order,
      is_active: item.is_active,
      is_counter: !!item.is_counter,
    })
    setModalOpen(true)
  }

  async function save(e) {
    e.preventDefault()

    if (!form.name.trim()) {
      toast.error('Unesi naziv artikla.')
      return
    }

    setSaving(true)
    const payload = {
      name: form.name.trim(),
      category: form.category.trim() || 'Ostalo',
      unit: form.unit,
      sort_order: Number(form.sort_order) || 100,
      is_active: form.is_active,
      is_counter: !!form.is_counter,
    }

    const { error } = form.id
      ? await supabase.from('items').update(payload).eq('id', form.id)
      : await supabase.from('items').insert(payload)

    setSaving(false)

    if (error) {
      toast.error(
        error.code === '23505'
          ? 'Artikal sa tim nazivom već postoji.'
          : errorMessage(error),
      )
      return
    }

    toast.success(form.id ? 'Artikal je izmenjen.' : 'Artikal je dodat.')
    setModalOpen(false)
    load()
  }

  async function toggleActive(item) {
    const { error } = await supabase
      .from('items')
      .update({ is_active: !item.is_active })
      .eq('id', item.id)

    if (error) toast.error(errorMessage(error))
    else {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, is_active: !i.is_active } : i)),
      )
      toast.success(
        item.is_active
          ? `${item.name} je isključen — nađeš ga dole pod „Isključeni“.`
          : `${item.name} je vraćen u popis.`,
      )
    }
  }

  async function remove(item) {
    const { error } = await supabase.from('items').delete().eq('id', item.id)
    setConfirmDelete(null)

    if (error) {
      // 23503 = artikal se koristi u nekom popisu -> ne brišemo istoriju
      if (error.code === '23503') {
        toast.error(
          'Artikal se pojavljuje u postojećim popisima pa ne može da se obriše. Isključi ga umesto toga.',
        )
        return
      }
      toast.error(errorMessage(error))
      return
    }
    toast.success('Artikal je obrisan.')
    load()
  }

  if (loading) return <FullPageLoader />

  return (
    <div className="space-y-4">
      <CategoryManager
        open={catManagerOpen}
        onClose={() => setCatManagerOpen(false)}
        categories={categories}
        items={items}
        onChanged={load}
      />

      {/* ---------- Koliko je čega prodato u mesecu ---------- */}
      <ItemSalesReport items={items} categories={categories} />

      <Card>
        {/* Cela sekcija je zatvorena dok se ne klikne na naslov. */}
        <button
          type="button"
          onClick={() => setListOpen((v) => !v)}
          aria-expanded={listOpen}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
        >
          <svg
            className={cx(
              'h-4 w-4 shrink-0 text-stone-400 transition-transform',
              listOpen && 'rotate-90',
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
            <span className="block text-[15px] font-semibold tracking-tight text-stone-900">
              Artikli
            </span>
            <span className="mt-0.5 block text-[13px] text-stone-500">
              {countLabel(items.filter((i) => i.is_active).length, [
                'aktivan',
                'aktivna',
                'aktivnih',
              ])}{' '}
              od {items.length}
            </span>
          </span>
        </button>

        {listOpen && (
        <>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-stone-100 px-4 py-2.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setOpenCats(openCats.size > 0 ? new Set() : new Set(grouped.map(([cat]) => cat)))
            }
          >
            {openCats.size > 0 ? 'Zatvori sve' : 'Otvori sve'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setCatManagerOpen(true)}>
            Kategorije
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
            Preuzmi popis
          </Button>
          <Button size="sm" className="ml-auto" onClick={openNew}>
            + Novi
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-y border-stone-200 px-4 py-3">
          <Input
            type="search"
            placeholder="Pretraži…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[180px]"
          />
        </div>

        {grouped.length === 0 ? (
          <EmptyState
            icon="📦"
            title="Nema artikala"
            description="Dodaj artikle koje radnici popisuju na kraju smene."
            action={<Button onClick={openNew}>Dodaj prvi artikal</Button>}
          />
        ) : (
          <div className="divide-y divide-stone-100">
            {grouped.map(([category, catItems]) => (
              <div key={category}>
                <CategoryToggle
                  title={category}
                  open={isCatOpen(category)}
                  onToggle={() => toggleCat(category)}
                  right={
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold tabular-nums text-stone-500 ring-1 ring-inset ring-stone-300">
                      {catItems.length}
                    </span>
                  }
                />
                <div className={cx('divide-y divide-stone-100', !isCatOpen(category) && 'hidden')}>
                  {catItems.map((item) => (
                    <div
                      key={item.id}
                      className={cx(
                        'flex items-center gap-3 px-4 py-2.5',
                        !item.is_active && 'opacity-60',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-stone-800">
                            {item.name}
                          </p>
                          {!item.is_active && (
                            <Badge className="bg-stone-200 text-stone-600 ring-stone-300">
                              isključen
                            </Badge>
                          )}
                          {item.is_counter && (
                            <Badge className="bg-brand-50 text-brand-700 ring-brand-600/20">
                              brojač
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-stone-400">
                          {item.unit} · redosled {item.sort_order}
                        </p>
                      </div>

                      <Button variant="ghost" size="sm" onClick={() => toggleActive(item)}>
                        {item.is_active ? 'Isključi' : 'Vrati'}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => openEdit(item)}>
                        Izmeni
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-rose-600"
                        onClick={() => setConfirmDelete(item)}
                      >
                        Obriši
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ---------- Isključeni artikli ---------- */}
        {inactiveItems.length > 0 && (
          <div className="border-t border-stone-100">
            <button
              type="button"
              onClick={() => setShowInactive((v) => !v)}
              aria-expanded={showInactive}
              className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-stone-50"
            >
              <svg
                className={cx(
                  'h-4 w-4 shrink-0 text-stone-400 transition-transform',
                  showInactive && 'rotate-90',
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
              <span className="text-[13px] font-semibold text-stone-600">Isključeni</span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-stone-500">
                {inactiveItems.length}
              </span>
              <span className="ml-auto text-[12px] text-stone-400">
                {showInactive ? 'sakrij' : 'prikaži'}
              </span>
            </button>

            {showInactive && (
              <div className="divide-y divide-stone-100 border-t border-stone-100">
                {inactiveItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 opacity-70">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-stone-800">{item.name}</p>
                      <p className="text-xs text-stone-400">
                        {item.category} · {item.unit}
                      </p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => toggleActive(item)}>
                      Vrati u popis
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-rose-600"
                      onClick={() => setConfirmDelete(item)}
                    >
                      Obriši
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        </>
        )}
      </Card>

      {/* Koje kategorije ulaze u odštampan popis */}
      <ReportPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Preuzmi popis za štampu"
        description="Prazan obrazac za ručni popis. Označi kategorije koje ti trebaju."
        options={printableGroups.map(([category, catItems]) => ({
          key: category,
          label: category,
          hint: countLabel(catItems.length, 'artikal'),
        }))}
        onConfirm={printPopis}
      />

      {/* ---------- Modal: dodavanje / izmena ---------- */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form.id ? 'Izmeni artikal' : 'Novi artikal'}
      >
        <form onSubmit={save} className="space-y-4">
          <Field label="Naziv" required>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="npr. Jelen 0.33"
              autoFocus
              required
            />
          </Field>

          <Field label="Kategorija" hint="Novu kategoriju dodaješ dugmetom „Kategorije“.">
            <Select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            >
              {catNames.length === 0 && <option value="Ostalo">Ostalo</option>}
              {catNames.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {/* Artikal iz kategorije koja je u međuvremenu obrisana */}
              {form.category && !catNames.includes(form.category) && (
                <option value={form.category}>{form.category} (van spiska)</option>
              )}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Jedinica mere">
              <Select
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Redosled" hint="Manji broj = više u listi.">
              <Input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="h-4 w-4 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
            />
            Aktivan (prikazuje se radnicima u popisu)
          </label>

          {/* Brojač: kasa broji unapred (espresso), pa se krajnje stanje
              računa kao početno + prodato, a ne kao kod zaliha. */}
          <label className="flex items-start gap-2 text-sm font-medium text-stone-700">
            <input
              type="checkbox"
              checked={form.is_counter}
              onChange={(e) => setForm((f) => ({ ...f, is_counter: e.target.checked }))}
              className="mt-0.5 h-4 w-4 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
            />
            <span>
              Broji unapred (brojač)
              <span className="mt-0.5 block text-[12px] font-normal text-stone-400">
                Krajnje = početno + prodato. Za espresso i slično, gde brojač samo raste.
              </span>
            </span>
          </label>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setModalOpen(false)}
            >
              Otkaži
            </Button>
            <Button type="submit" className="flex-1" loading={saving}>
              Sačuvaj
            </Button>
          </div>
        </form>
      </Modal>

      {/* ---------- Modal: brisanje ---------- */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Obriši artikal"
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(null)}>
              Otkaži
            </Button>
            <Button variant="danger" className="flex-1" onClick={() => remove(confirmDelete)}>
              Obriši
            </Button>
          </div>
        }
      >
        <p className="text-sm text-stone-600">
          Da li sigurno želiš da obrišeš <strong>{confirmDelete?.name}</strong>? Ako je artikal već
          korišćen u nekom popisu, bolje je da ga samo isključiš.
        </p>
      </Modal>
    </div>
  )
}
