import { supabase } from './supabaseClient'

/**
 * Obračun zarade po obračunskom periodu (1.–15. i 16.–kraj meseca).
 *
 * Radnik može da bude na DNEVNICI ili na PLATI, a uz oba može da ide i
 * PROCENAT od pazara smena koje je radio:
 *
 *   dnevnica   →  osnova = broj ODRAĐENIH DANA × dnevnica
 *   plata      →  osnova = mesečna plata ÷ 2 (period je pola meseca)
 *   procenat   →  + (pazar njegovih smena × procenat)
 *
 *   zarađeno   = osnova + procenat
 *   za isplatu = zarađeno + bonusi − isplaćeno
 *
 * Dnevnica se računa PO DANU, a ne po smeni: ko radi međusmenu ulazi i u
 * prvu i u drugu smenu, ali mu se taj dan računa kao jedna dnevnica.
 * Procenat se i dalje računa od pazara SVIH smena u kojima je bio.
 *
 * Admin može na pojedinom izveštaju da UMANJI dnevnicu baš za taj dan
 * (`shift_report_staff.wage_override`) — npr. ako je radnik odradio pola
 * smene. Taj iznos zamenjuje redovnu dnevnicu za taj dan; ako je istog dana
 * bio u dve smene, uzima se najmanji upisani iznos.
 *
 * Dan se računa svakom ko je bio u smeni (ako rade dvoje, oboje dobijaju
 * punu dnevnicu). Vraćeni izveštaji se ne broje dok se ne isprave.
 *
 * Smene se biraju po datumu (from–to), a isplate i bonusi po `period_key`,
 * jer se isplata dešava POSLE perioda — 16. odnosno 1. u mesecu.
 */

/** Učitava smene, isplate i bonuse za period. Vraća Map(profileId -> statistika). */
export async function loadWorkStats({ from, to, periodKey, profileId = null }) {
  let shiftQuery = supabase
    .from('shift_report_staff')
    .select(
      'profile_id, wage_override, report:shift_reports!inner ( id, report_date, shift, status, total_amount )',
    )
    .gte('report.report_date', from)
    .lte('report.report_date', to)

  let payoutQuery = supabase
    .from('payouts')
    .select('id, profile_id, kind, amount, paid_on, period_key, note')
    .eq('period_key', periodKey)
    .order('paid_on', { ascending: false })

  if (profileId) {
    shiftQuery = shiftQuery.eq('profile_id', profileId)
    payoutQuery = payoutQuery.eq('profile_id', profileId)
  }

  const [shiftsRes, payoutsRes] = await Promise.all([shiftQuery, payoutQuery])
  if (shiftsRes.error) throw shiftsRes.error
  if (payoutsRes.error) throw payoutsRes.error

  const stats = new Map()
  const get = (id) => {
    if (!stats.has(id)) {
      stats.set(id, {
        shifts: 0,
        days: 0, // broj RAZLIČITIH dana — po njemu ide dnevnica
        // datum -> niz umanjenih iznosa upisanih za taj dan (prazno = puna)
        dates: new Map(),
        returned: 0,
        open: 0,
        paid: 0,
        bonus: 0,
        pazar: 0, // zbir pazara smena koje je radio — osnova za procenat
        shiftList: [],
        payouts: [],
      })
    }
    return stats.get(id)
  }

  for (const row of shiftsRes.data ?? []) {
    const entry = get(row.profile_id)
    const status = row.report?.status

    // Otvorena smena još traje, vraćena se ispravlja — ni jedna ne ulazi u obračun.
    if (status === 'poslat' || status === 'potvrdjen') {
      entry.shifts += 1
      const date = row.report?.report_date
      if (date) {
        if (!entry.dates.has(date)) entry.dates.set(date, [])
        if (row.wage_override !== null && row.wage_override !== undefined) {
          entry.dates.get(date).push(Number(row.wage_override))
        }
      }
      entry.pazar += Number(row.report?.total_amount ?? 0)
      entry.shiftList.push({ ...row.report, wage_override: row.wage_override ?? null })
    } else if (status === 'vracen') {
      entry.returned += 1
    } else {
      entry.open += 1
    }
  }

  for (const payout of payoutsRes.data ?? []) {
    const entry = get(payout.profile_id)
    if (payout.kind === 'bonus') entry.bonus += Number(payout.amount ?? 0)
    else entry.paid += Number(payout.amount ?? 0)
    entry.payouts.push(payout)
  }

  for (const entry of stats.values()) {
    entry.days = entry.dates.size
    entry.shiftList.sort((a, b) => b.report_date.localeCompare(a.report_date))
  }

  return stats
}

/** Prazna statistika — za radnika koji u periodu nije radio. */
export const EMPTY_STATS = {
  shifts: 0,
  days: 0,
  dates: new Map(),
  returned: 0,
  open: 0,
  paid: 0,
  bonus: 0,
  pazar: 0,
  shiftList: [],
  payouts: [],
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** Spaja profil i statistiku u red obračuna. */
export function settle(profile, stats = EMPTY_STATS) {
  const model = profile?.pay_model === 'plata' ? 'plata' : 'dnevnica'
  const wage = Number(profile?.daily_wage ?? 0)
  const salary = Number(profile?.monthly_salary ?? 0)
  const percent = Number(profile?.percent ?? 0)

  // Dnevnica ide po danu: međusmena u dve smene istog dana = jedna dnevnica.
  const days = stats.days ?? stats.shifts

  /* Zbir dnevnica: za svaki dan puna dnevnica, osim ako je admin za taj dan
     upisao umanjeni iznos (ako ih je više, važi najmanji). */
  let wageSum = 0
  let reduced = 0
  for (const overrides of stats.dates?.values() ?? []) {
    if (overrides.length > 0) {
      wageSum += Math.min(...overrides)
      reduced += 1
    } else {
      wageSum += wage
    }
  }

  // Plata je mesečna, a obračunski period je pola meseca.
  const base = model === 'plata' ? round2(salary / 2) : round2(wageSum)
  const fromPercent = percent > 0 ? round2((stats.pazar * percent) / 100) : 0
  const earned = round2(base + fromPercent)

  return {
    model,
    wage,
    salary,
    percent,
    base,
    pazar: stats.pazar,
    fromPercent,
    days,
    reduced, // koliko je dana sa umanjenom dnevnicom
    shifts: stats.shifts,
    returned: stats.returned,
    open: stats.open,
    earned,
    bonus: stats.bonus,
    paid: stats.paid,
    balance: round2(earned + stats.bonus - stats.paid),
    shiftList: stats.shiftList,
    payouts: stats.payouts,
    bonuses: stats.payouts.filter((p) => p.kind === 'bonus'),
    payments: stats.payouts.filter((p) => p.kind !== 'bonus'),
  }
}
