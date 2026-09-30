import { forwardRef, useEffect } from 'react'
import { cx } from '../lib/utils'

/* ------------------------------------------------------------------ */
/*  Dugme                                                              */
/* ------------------------------------------------------------------ */
/**
 * Tri nivoa važnosti i ništa više:
 *   primary   — glavna radnja na ekranu (tamna, puna)
 *   secondary — sve ostalo (bela sa tankom linijom)
 *   ghost     — sporedne radnje (bez okvira)
 * success/danger samo kad radnja nešto potvrđuje ili briše.
 */
const VARIANTS = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 focus-visible:ring-brand-500',
  secondary:
    'bg-white text-stone-700 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 active:bg-stone-100 focus-visible:ring-stone-400',
  success:
    'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 focus-visible:ring-emerald-500',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 focus-visible:ring-rose-500',
  ghost: 'text-stone-600 hover:bg-stone-100 active:bg-stone-200 focus-visible:ring-stone-400',
  dark: 'bg-ink text-white hover:bg-ink-800 focus-visible:ring-stone-500',
}

const SIZES = {
  sm: 'px-3 py-1.5 text-[13px] gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-2',
  lg: 'px-5 py-3 text-base gap-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...props
}) {
  return (
    <button
      className={cx(
        'inline-flex select-none items-center justify-center rounded-xl font-semibold transition',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Spinner                                                            */
/* ------------------------------------------------------------------ */
export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  )
}

export function FullPageLoader({ label = 'Učitavanje…' }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-stone-500">
      <Spinner className="h-8 w-8 text-brand-600" />
      <p className="text-sm font-medium">{label}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Kartica                                                            */
/* ------------------------------------------------------------------ */
export function Card({ className, children, ...props }) {
  return (
    <div className={cx('card', className)} {...props}>
      {children}
    </div>
  )
}

/**
 * Naslov kartice. `subtitle` je za podatak (koliko ih ima, koji period) —
 * ne za objašnjenje šta kartica radi; to se vidi iz same kartice.
 */
export function CardHeader({ title, subtitle, action, className }) {
  return (
    <div
      className={cx('flex items-center justify-between gap-3 px-4 pb-1 pt-4', className)}
    >
      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-bold tracking-tight text-stone-900">{title}</h2>
        {subtitle && <p className="mt-0.5 truncate text-[12px] text-stone-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Polja                                                              */
/* ------------------------------------------------------------------ */
export function Field({ label, hint, error, children, required, className }) {
  return (
    <div className={className}>
      {label && (
        <label className="label">
          {label}
          {required && <span className="text-rose-600"> *</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
      {error && <p className="mt-1 text-xs font-medium text-rose-600">{error}</p>}
    </div>
  )
}

export const Input = forwardRef(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cx('field', className)} {...props} />
})

export function Select({ className, children, ...props }) {
  return (
    <select className={cx('field appearance-none pr-9', className)} {...props}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...props }) {
  return <textarea className={cx('field resize-y', className)} rows={3} {...props} />
}

/** Polje za novac — veliko, pregledno, mobile-friendly. */
export function MoneyInput({ value, onChange, ...props }) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.target.select()}
        className="field pr-14 text-right text-lg font-bold tabular-nums"
        placeholder="0"
        {...props}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm font-semibold text-stone-400">
        RSD
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Bedž                                                               */
/* ------------------------------------------------------------------ */
export function Badge({ className, children }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
        className ?? 'bg-stone-100 text-stone-700 ring-stone-600/20',
      )}
    >
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Prazno stanje                                                      */
/* ------------------------------------------------------------------ */
export function EmptyState({ icon = '📋', title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center">
      <div className="mb-1 text-3xl opacity-60">{icon}</div>
      <h3 className="text-[15px] font-bold text-stone-700">{title}</h3>
      {description && <p className="max-w-[16rem] text-[13px] text-stone-400">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Modal                                                              */
/* ------------------------------------------------------------------ */
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)

    /* Pozadina se zaključava BEZ skoka na vrh: telo se „zamrzne“ tačno na
       poziciji na kojoj si bio (position:fixed + negativan top), a pri
       zatvaranju se skrol vrati na isto mesto. Samo `overflow:hidden` bi te
       na telefonu izbacilo na vrh strane. */
    const y = window.scrollY
    const saved = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    }
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${y}px`
    document.body.style.width = '100%'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = saved.overflow
      document.body.style.position = saved.position
      document.body.style.top = saved.top
      document.body.style.width = saved.width
      window.scrollTo(0, y)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl animate-slide-up sm:rounded-3xl',
          size === 'sm' && 'sm:max-w-sm',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-3xl',
          size === 'xl' && 'sm:max-w-5xl',
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-100 bg-white px-4 py-3.5">
          <h2 className="text-[15px] font-bold tracking-tight text-stone-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
            aria-label="Zatvori"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.3 5A.9.9 0 105 6.3L8.7 10 5 13.7A.9.9 0 106.3 15L10 11.3l3.7 3.7a.9.9 0 001.3-1.3L11.3 10 15 6.3A.9.9 0 1013.7 5L10 8.7 6.3 5z" />
            </svg>
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && (
          <div className="sticky bottom-0 border-t border-stone-200 bg-white px-4 py-3 safe-bottom">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Padajuća kategorija (akordeon)                                     */
/* ------------------------------------------------------------------ */
export function CategoryToggle({ title, open, onToggle, right, children }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cx(
        'flex w-full items-center gap-2.5 px-4 py-3 text-left transition',
        open ? 'bg-stone-100' : 'bg-stone-50 hover:bg-stone-100',
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

      <span className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-wide text-stone-600">
        {title}
      </span>

      {right}
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Statistička pločica                                                */
/* ------------------------------------------------------------------ */
/**
 * Pločica sa brojem. Jedna boja na ekranu — narandžasta ide samo na broj koji
 * je zaista glavni (`tone="total"`), sve ostalo je crno. Manje šarenila, brže
 * se čita. `sub` je za retke slučajeve; RSD se podrazumeva i ne piše se.
 */
export function Stat({ label, value, sub, tone = 'default' }) {
  const tones = {
    default: 'text-stone-900',
    cash: 'text-stone-900',
    card: 'text-stone-900',
    expense: 'text-rose-600',
    total: 'text-brand-600',
  }

  return (
    <div className="flex min-w-0 flex-col items-center px-3 py-3 text-center">
      {/* Naslov se prelama u dva reda umesto da se seče, a `min-h` drži
          dvoredni prostor i kad je naslov kratak — tako svi brojevi u nizu
          stoje na istoj liniji. */}
      <p className="eyebrow min-h-[26px] leading-tight">{label}</p>
      <p
        className={cx(
          'text-[18px] font-bold tabular-nums tracking-tight sm:text-[21px]',
          tones[tone] ?? tones.default,
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-stone-400">{sub}</p>}
    </div>
  )
}

/** Grupa pločica — jedna kartica, tanke linije između, bez okvira po pločici. */
export function StatRow({ className, children }) {
  return (
    <div
      className={cx(
        'grid divide-x divide-y divide-stone-100 overflow-hidden rounded-3xl border border-stone-200/70 bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04)]',
        '[&>*]:min-w-0 [&>*]:border-0',
        className,
      )}
    >
      {children}
    </div>
  )
}
