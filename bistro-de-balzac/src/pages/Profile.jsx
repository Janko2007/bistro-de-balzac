import { useAuth } from '../context/AuthContext'
import { AvatarEditor } from '../components/Avatar'
import RuleDocs from '../components/RuleDocs'
import { Card } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'
import MyEarnings from './MyEarnings'

/**
 * Profil radnika — redom:
 *   1. slika i osnovni podaci (ime, telefon, uloga, dnevnica)
 *   2. dnevnice (obračun, odrađene smene, bonusi i isplate)
 *   3. pravila i obaveze (svaki dokument zatvoren dok se ne klikne)
 */
export default function Profile() {
  const { profile, isAdmin, refreshProfile } = useAuth()

  const rows = [
    ['Ime i prezime', profile?.full_name || '—'],
    ['Broj telefona', profile?.phone || '—'],
    ['Uloga', isAdmin ? 'Vlasnik' : 'Radnik'],
    ['Dnevnica', formatMoney(profile?.daily_wage)],
    ['U timu od', profile?.created_at ? formatDate(profile.created_at.slice(0, 10)) : '—'],
  ]

  return (
    <div className="space-y-4">
      {/* ---------- Osnovni podaci ---------- */}
      <Card>
        <div className="px-4 py-4">
          {profile && (
            <AvatarEditor
              person={profile}
              className="h-[68px] w-[68px] bg-brand-600 text-xl text-white"
              onChange={refreshProfile}
            >
              <h1 className="truncate text-lg font-bold tracking-tight text-stone-900">
                {profile.full_name}
              </h1>
              <p className="text-sm text-stone-500">{isAdmin ? 'Vlasnik' : 'Radnik'}</p>
            </AvatarEditor>
          )}
        </div>

        <dl className="divide-y divide-stone-100 border-t border-stone-100">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5">
              <dt className="text-[13px] text-stone-500">{label}</dt>
              <dd className="min-w-0 truncate text-right text-sm font-semibold text-stone-900">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* ---------- Dnevnice ---------- */}
      <MyEarnings />

      {/* ---------- Pravila i obaveze ---------- */}
      <RuleDocs />
    </div>
  )
}
