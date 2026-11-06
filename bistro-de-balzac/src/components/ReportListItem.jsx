import { Link } from 'react-router-dom'
import { Badge } from './ui'
import MidMark from './MidMark'
import {
  SHIFT_SHORT,
  SHIFT_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
  formatDate,
  formatMoney,
} from '../lib/utils'

/** Rimski broj smene na pločici u adminovom spisku. */
const SHIFT_ROMAN = { prva: 'I', druga: 'II', medjusmena: 'M' }

/** Oznaka smene — međusmena je narandžasta, pa se odmah vidi u spisku dana. */
function ShiftTag({ shift }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${
        SHIFT_STYLES[shift] ?? SHIFT_STYLES.prva
      }`}
    >
      {SHIFT_SHORT[shift] ?? shift}
    </span>
  )
}

/**
 * Jedan red u spisku izveštaja.
 *
 * `compact` — samo datum, smena i stanje, bez iznosa (radnikov spisak);
 * iznosi se vide tek kad se izveštaj otvori.
 *
 * `staffNames` — svi koji su radili smenu. Bez njih bi stajalo samo ime onoga
 * ko je prvi ušao u smenu, pa bi delovalo kao da je radio sam.
 */
export default function ReportListItem({
  report,
  showAuthor = false,
  compact = false,
  staffNames = [],
  alert = null, // 'manjak' | 'fix' — samo u radnikovom spisku
}) {
  // Radnikov spisak: jedan red, iste kolone u svakom — datum | smena | stanje.
  // Svi redovi su iste visine i sve stoji poravnato, pa 8 izveštaja stane na
  // ekran telefona bez pomeranja.
  if (compact) {
    return (
      <Link
        to={`/izvestaj/${report.id}`}
        className="grid grid-cols-[80px_minmax(0,1fr)_auto_14px] items-center gap-x-2 px-3.5 py-[11px] transition hover:bg-stone-50 active:bg-stone-100"
      >
        <span className="whitespace-nowrap text-[13px] font-bold text-stone-900">
          {formatDate(report.report_date)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <ShiftTag shift={report.shift} />
          {/* Uz izveštaj stoji poruka od admina — da se vidi i bez otvaranja. */}

          {report.has_admin_note && (
            <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
              poruka
            </span>
          )
}
        </span>
        {/* Manja oznaka nego inače, da i „Vraćen na ispravku“ stane u isti red. */}
        {/* Manjak stoji umesto stanja izveštaja; ispravka je narandžasta. */}
        <Badge
          className={`${
            alert === 'manjak'
              ? 'bg-rose-100 text-rose-700 ring-rose-600/20'
              : alert === 'fix'
                ? 'bg-brand-100 text-brand-800 ring-brand-600/20'
                : STATUS_STYLES[report.status]
          } justify-self-end whitespace-nowrap !px-2 !py-0.5 !text-[11px]`}
        >
          {alert === 'manjak' ? 'Manjak' : STATUS_LABELS[report.status]}
        </Badge>
        <svg
          className="h-3.5 w-3.5 text-stone-300"
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
      </Link>
    )
  }

  // adminov spisak (Pregled je grupisan po danima — datum je već u traci dana iznad).
  //   levo:   pločica smene (I / II)
  //   sredina: ko je radio, pa keš i kartice
  //   desno:  pazar, a ispod njega stanje izveštaja
  return (
    <Link
      to={`/izvestaj/${report.id}`}
      className="flex items-center gap-2.5 px-4 py-3 transition hover:bg-stone-50 active:bg-stone-100"
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[14px] font-extrabold ring-1 ring-inset ${
          SHIFT_STYLES[report.shift] ?? SHIFT_STYLES.prva
        }`}
        title={SHIFT_SHORT[report.shift] ?? report.shift}
      >
        {SHIFT_ROMAN[report.shift] ?? '·'}
      </span>

      <span className="min-w-0 flex-1">
        {showAuthor && (
          <span className="block text-[14px] font-semibold leading-snug text-stone-900">
            {staffNames.length > 0
              ? staffNames.map((s, i) => {
                  const name = typeof s === 'string' ? s : s.name
                  const mid = typeof s === 'string' ? false : s.mid
                  return (
                    <span key={`${name}-${i}`} className="whitespace-nowrap">
                      {name}
                      {mid && <MidMark className="ml-1 align-middle" />}
                      {i < staffNames.length - 1 && ', '}
                    </span>
                  )
                })
              : 'nema upisanih'}
          </span>
        )
}
        {/* Keš i kartice uvek u jednom redu — ime je gore, ovo dole, bez trećeg reda. */}
        <span className="mt-0.5 block truncate whitespace-nowrap text-[11.5px] leading-snug tabular-nums text-stone-500">
          <b className="whitespace-nowrap font-bold text-brand-700">
            keš {formatMoney(report.cash_amount, false)}
          </b>
          {' · '}
          <span className="whitespace-nowrap">kartice {formatMoney(report.card_amount, false)}</span>
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[16px] font-extrabold tabular-nums leading-none text-stone-900">
          {formatMoney(report.total_amount, false)}
        </span>
        <Badge
          className={`${STATUS_STYLES[report.status]} whitespace-nowrap !px-1.5 !py-0.5 !text-[10px]`}
        >
          {/* Kraće nego u radnikovom spisku, da keš i kartice uvek stanu u jedan red. */}
          {report.status === 'vracen' ? 'Na ispravci' : STATUS_LABELS[report.status]}
        </Badge>
      </span>
    </Link>
  )
}
