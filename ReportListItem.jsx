import { Link } from 'react-router-dom'
import { Badge } from './ui'
import {
  SHIFT_SHORT,
  SHIFT_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
  formatDate,
  formatMoney,
} from '../lib/utils'

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
          )}
        </span>
        {/* Manja oznaka nego inače, da i „Vraćen na ispravku“ stane u isti red. */}
        <Badge
          className={`${STATUS_STYLES[report.status]} justify-self-end whitespace-nowrap !px-2 !py-0.5 !text-[11px]`}
        >
          {STATUS_LABELS[report.status]}
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

  // adminov spisak (Pregled je grupisan po danima — datum je već u traci
  // dana iznad): svaki red ista dva reda.
  //   gore:  smena · radnik              pazar
  //   dole:  kartice · predato           stanje
  // Svaki od dva reda se deli za sebe — gornji ima mesta koliko je širok
  // pazar, donji koliko je široka oznaka stanja.
  return (
    <Link
      to={`/izvestaj/${report.id}`}
      className="flex items-center gap-2.5 px-4 py-3 transition hover:bg-stone-50 active:bg-stone-100"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center justify-between gap-2.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <ShiftTag shift={report.shift} />
            {showAuthor && (
              <span className="min-w-0 truncate text-[13.5px] font-semibold text-stone-900">
                {staffNames.length > 0 ? staffNames.join(', ') : 'nema upisanih'}
              </span>
            )}
          </span>
          {/* Pazar */}
          <span className="shrink-0 text-[15px] font-bold tabular-nums text-stone-900">
            {formatMoney(report.total_amount, false)}
          </span>
        </span>

        <span className="flex min-w-0 items-center justify-between gap-2.5">
          <span className="min-w-0 truncate text-[11px] tabular-nums text-stone-400">
            kartice {formatMoney(report.card_amount, false)} · predato{' '}
            {formatMoney(report.cash_amount, false)}
          </span>
          <Badge
            className={`${STATUS_STYLES[report.status]} shrink-0 whitespace-nowrap !px-2 !py-0.5 !text-[11px]`}
          >
            {STATUS_LABELS[report.status]}
          </Badge>
        </span>
      </span>

      <svg
        className="h-3.5 w-3.5 shrink-0 text-stone-300"
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
