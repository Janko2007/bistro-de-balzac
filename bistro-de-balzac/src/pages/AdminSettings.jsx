import { useAuth } from '../context/AuthContext'
import { AvatarEditor } from '../components/Avatar'
import AboutApp from '../components/AboutApp'
import MyDetails from '../components/MyDetails'
import ShiftFormEditor from '../components/ShiftFormEditor'
import ThemePicker from '../components/ThemePicker'
import { Card } from '../components/ui'
import AdminItems from './AdminItems'

/** Grupa u podešavanjima: sitan naslov, pa kartice. */
function Group({ title, children }) {
  return (
    <section className="space-y-3">
      <h2 className="eyebrow px-1">{title}</h2>
      {children}
    </section>
  )
}

/**
 * Podešavanja (admin) — sve na jednom mestu, u tri grupe:
 *   1. Moj profil: slika, ime, telefon i radno iskustvo
 *   2. Aplikacija: boja i izgled smene
 *   3. Artikli: prodaja po artiklima, spisak artikala, kategorije i popisi
 *   4. O aplikaciji (na dnu, jer je najduža)
 */
export default function AdminSettings() {
  const { profile, refreshProfile } = useAuth()

  const meta = ['Admin', profile?.position?.trim()].filter(Boolean).join(' · ')

  return (
    <div className="space-y-7">
      <Group title="Moj profil">
        <Card className="px-4 py-4">
          {profile && (
            <AvatarEditor
              person={profile}
              className="h-[68px] w-[68px] bg-brand-600 text-xl text-white"
              onChange={refreshProfile}
            >
              <h1 className="truncate text-lg font-bold tracking-tight text-stone-900">{profile.full_name}</h1>
            </AvatarEditor>
          )}
        </Card>
        <MyDetails role={meta} />
      </Group>

      <Group title="Aplikacija">
        <ThemePicker />
        <ShiftFormEditor />
      </Group>

      <Group title="Artikli">
        <AdminItems embedded />
      </Group>

      <Group title="O aplikaciji">
        <AboutApp />
      </Group>
    </div>
  )
}
