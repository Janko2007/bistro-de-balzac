import { useEffect, useState } from 'react'

import { Button, Modal } from './ui'
import { cx } from '../lib/utils'

/**
 * Izbor šta ulazi u izveštaj pre preuzimanja.
 *
 * Svaki ekran zove isti prozor i samo prosledi spisak delova koje nudi
 * (`options`). Štiklirano se štampa, ostalo se izostavlja — tako se sa istog
 * dugmeta dobije i kratak pregled i potpun izveštaj.
 *
 *   options: [{ key, label, hint, default: false }]
 *   onConfirm(nizIzabranihKljuceva)
 */
export default function ReportPicker({
  open,
  onClose,
  title = 'Preuzmi izveštaj',
  description = 'Otvoriće se uredan izveštaj — tu biraš „Sačuvaj kao PDF“ ili štampač.',
  options = [],
  confirmLabel = 'Preuzmi',
  onConfirm,
}) {
  const [chosen, setChosen] = useState(() => new Set())

  // Svako otvaranje kreće od podrazumevanog izbora.
  useEffect(() => {
    if (!open) return
    setChosen(new Set(options.filter((o) => o.default !== false).map((o) => o.key)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function toggle(key) {
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const allOn = options.length > 0 && options.every((o) => chosen.has(o.key))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Otkaži
          </Button>
          <Button
            className="flex-1"
            disabled={chosen.size === 0}
            onClick={() => {
              onClose()
              onConfirm(options.filter((o) => chosen.has(o.key)).map((o) => o.key))
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-stone-600">{description}</p>
        {options.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() =>
              setChosen(allOn ? new Set() : new Set(options.map((o) => o.key)))
            }
          >
            {allOn ? 'Poništi' : 'Označi sve'}
          </Button>
        )}
      </div>

      <div className="mt-3 space-y-1.5">
        {options.map((option) => {
          const on = chosen.has(option.key)
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => toggle(option.key)}
              aria-pressed={on}
              className={cx(
                'flex w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition',
                on ? 'border-brand-500 bg-brand-50' : 'border-stone-200 bg-white hover:bg-stone-50',
              )}
            >
              <span
                className={cx(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold transition',
                  on ? 'bg-brand-600 text-white' : 'bg-stone-100 text-transparent',
                )}
              >
                ✓
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-stone-900">{option.label}</span>
                {option.hint && (
                  <span className="mt-0.5 block text-xs text-stone-500">{option.hint}</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
