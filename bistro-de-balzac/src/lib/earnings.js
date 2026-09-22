import { supabase } from './supabaseClient'

/**
 * Obračun dnevnica po obračunskom periodu (1.–15. i 16.–kraj meseca).
 *
 *   zarađeno   = broj odrađenih smena × dnevnica
 *   za isplatu = zarađeno + bonusi − isplaćeno
 *
 * Smena se računa svakom ko je bio u njoj (ako rade dvoje, oboje dobijaju
 * punu dnevnicu). Vraćeni izveštaji se ne broje dok se ne isprave.
 *
 * Smene se biraju po datumu (from–to), a isplate i bonusi po `period_key`,
 * jer se isplata dešava POSLE perioda — 16. odnosno 1. u mesecu.
 */

/** Učitava smene, isplate i bonuse za period. Vraća Map(profileId -> statistika). */
export async function loadWorkStats({ from, to, periodKey, profileId = null }) {
  let shiftQuery = supabase
    .from('shift_report_staff')
    .select('profile_id, report:shift_reports!inner ( id, report_date, shift, status )')
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
        returned: 0,
        open: 0,
        paid: 0,
        bonus: 0,
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
      entry.shiftList.push(row.report)
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
    entry.shiftList.sort((a, b) => b.report_date.localeCompare(a.report_date))
  }

  return stats
}

/** Prazna statistika — za radnika koji u periodu nije radio. */
export const EMPTY_STATS = {
  shifts: 0,
  returned: 0,
  open: 0,
  paid: 0,
  bonus: 0,
  shiftList: [],
  payouts: [],
}

/** Spaja profil i statistiku u red obračuna. */
export function settle(profile, stats = EMPTY_STATS) {
  const wage = Number(profile?.daily_wage ?? 0)
  const earned = stats.shifts * wage
  return {
    wage,
    shifts: stats.shifts,
    returned: stats.returned,
    open: stats.open,
    earned,
    bonus: stats.bonus,
    paid: stats.paid,
    balance: earned + stats.bonus - stats.paid,
    shiftList: stats.shiftList,
    payouts: stats.payouts,
    bonuses: stats.payouts.filter((p) => p.kind === 'bonus'),
    payments: stats.payouts.filter((p) => p.kind !== 'bonus'),
  }
}
