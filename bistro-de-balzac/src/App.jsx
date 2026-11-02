import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import Layout from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useAuth } from './context/AuthContext'
import { FullPageLoader } from './components/ui'
import { isSupabaseConfigured } from './lib/supabaseClient'

/**
 * Ekrani se učitavaju tek kad zatrebaju, pa se pri otvaranju aplikacije
 * skida samo ono što je potrebno (radnik ne skida admin ekrane i obrnuto).
 *
 * Ako posle nove verzije pregledač traži stari fajl koji više ne postoji,
 * stranica se jednom sama osveži umesto da ostane prazna.
 */
const RELOAD_FLAG = 'bdb.chunk-reload'
function lazyPage(load) {
  return lazy(() =>
    load()
      .then((mod) => {
        try {
          window.sessionStorage.removeItem(RELOAD_FLAG)
        } catch {
          /* bez skladišta */
        }
        return mod
      })
      .catch((err) => {
        try {
          if (!window.sessionStorage.getItem(RELOAD_FLAG)) {
            window.sessionStorage.setItem(RELOAD_FLAG, '1')
            window.location.reload()
            return new Promise(() => {})
          }
        } catch {
          /* bez skladišta */
        }
        throw err
      }),
  )
}

const Login = lazyPage(() => import('./pages/Login'))
const NewReport = lazyPage(() => import('./pages/NewReport'))
const Profile = lazyPage(() => import('./pages/Profile'))
const ReportDetail = lazyPage(() => import('./pages/ReportDetail'))
const AdminDashboard = lazyPage(() => import('./pages/AdminDashboard'))
const AdminSettings = lazyPage(() => import('./pages/AdminSettings'))
const AdminWorkers = lazyPage(() => import('./pages/AdminWorkers'))
const Schedule = lazyPage(() => import('./pages/Schedule'))

/** Početna strana zavisi od uloge: admin -> dashboard, radnik -> novi popis. */
function HomeRoute() {
  const { isAdmin } = useAuth()
  return isAdmin ? <AdminDashboard /> : <NewReport />
}

function MissingConfig() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 p-6">
      <div className="card max-w-lg p-6">
        <h1 className="text-lg font-bold text-rose-700">Nedostaje Supabase konfiguracija</h1>
        <p className="mt-2 text-sm text-stone-600">
          Napravi fajl <code className="rounded bg-stone-100 px-1">.env</code> u korenu projekta sa:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-stone-900 p-3 text-xs text-stone-100">
{`VITE_SUPABASE_URL=https://tvoj-projekat.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
        </pre>
        <p className="mt-3 text-sm text-stone-600">
          Zatim restartuj <code className="rounded bg-stone-100 px-1">npm run dev</code>. Ako je
          aplikacija već objavljena, dodaj iste promenljive u podešavanjima na Vercel/Netlify i
          pokreni novi deploy.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  if (!isSupabaseConfigured) return <MissingConfig />

  return (
    <Routes>
      <Route
        path="/prijava"
        element={
          <Suspense fallback={<FullPageLoader />}>
            <Login />
          </Suspense>
        }
      />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<HomeRoute />} />
        <Route path="novi-popis" element={<NewReport />} />
        {/* Izveštaji su sada u Profilu — stara adresa vodi tamo. */}
        <Route path="moji-izvestaji" element={<Navigate to="/profil" replace />} />
        <Route path="profil" element={<Profile />} />
        <Route path="raspored" element={<Schedule />} />
        {/* Stare adrese — ako je neko sačuvao link ili ikonicu na telefonu. */}
        <Route path="moje-dnevnice" element={<Navigate to="/profil" replace />} />
        <Route path="tim" element={<Navigate to="/profil" replace />} />
        <Route path="izvestaj/:id" element={<ReportDetail />} />

        <Route
          path="podesavanja"
          element={
            <ProtectedRoute adminOnly>
              <AdminSettings />
            </ProtectedRoute>
          }
        />
        {/* Artikli su sada u Podešavanjima — stara adresa vodi tamo. */}
        <Route path="artikli" element={<Navigate to="/podesavanja" replace />} />
        <Route
          path="radnici"
          element={
            <ProtectedRoute adminOnly>
              <AdminWorkers />
            </ProtectedRoute>
          }
        />
        {/* Uplate su sada u Pregledu — stara adresa vodi tamo. */}
        <Route path="uplate" element={<Navigate to="/" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
