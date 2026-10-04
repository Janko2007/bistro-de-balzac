import { useAuth } from '../context/AuthContext'
import { AvatarEditor } from '../components/Avatar'
import BadgeInfo from '../components/BadgeInfo'
import MyDetails from '../components/MyDetails'
import RuleDocs from '../components/RuleDocs'
import { Card } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'
import MyEarnings from './MyEarnings'
import Team from './Team'

/**
 * Profil radnika — jednostavno, od gore na dole:
 *   1. slika, ime i jedan red (dnevnica, u timu od)
 *   2. moji podaci (telefon i radno iskustvo — radnik ih upisuje sam)
 *   3. dnevnice (obračun, odrađene smene, bonusi i isplate)
 *   4. Tim, Bedževi, Radnici meseca — jedna kartica, tri reda koja se otvaraju
 *   5. pravila i obaveze
 */
export default function Profile() {
  const { profile, isAdmin, refreshProfile } = useAuth()

  const naPlati = profile?.pay_model === 'plata'
  const procenat = Number(profile?.percent ?? 0)

  // Sve što je ranije bilo u tabeli — u jednom redu ispod imena.
  const meta = [
    isAdmin ? 'Admin' : 'Radnik',
    naPlati
      ? `plata ${formatMoney(profile?.monthly_salary, false)}`
      : `dnevnica ${formatMoney(profile?.daily_wage, false)}`,
    procenat > 0 ? `${procenat}%` : null,
    profile?.created_at ? `u timu od ${formatDate(profile.created_at.slice(0, 10))}` : null,
  ].filter(Boolean)

  return (
    <div className="space-y-4">
      {/* ---------- Ja ---------- */}
      <Card className="px-4 py-4">
        {profile && (
          <AvatarEditor
            person={profile}
            className="h-[68px] w-[68px] bg-brand-600 text-xl text-white"
            onChange={refreshProfile}
          >
            <h1 className="truncate text-lg font-bold tracking-tight text-stone-900">
              {profile.full_name}
            </h1>
            <p className="text-sm text-stone-500">{meta.join(' · ')}</p>
          </AvatarEditor>
        )}
      </Card>

      {/* ---------- Telefon i radno iskustvo — radnik ih upisuje sam ---------- */}
      <MyDetails />

      {/* ---------- Dnevnice ---------- */}
      <MyEarnings />

      {/* ---------- Tim, Bedževi i Radnici meseca — jedna kartica ---------- */}
      <Card className="divide-y divide-stone-100">
        <Team bare />
        <BadgeInfo bare />
      </Card>

      {/* ---------- Pravila i obaveze ---------- */}
      <RuleDocs />
    </div>
  )
}
