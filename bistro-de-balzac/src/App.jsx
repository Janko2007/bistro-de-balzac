import { Navigate, Route, Routes } from 'react-router-dom'

import Layout from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useAuth } from './context/AuthContext'
import { isSupabaseConfigured } from './lib/supabaseClient'

import Login from './pages/Login'
import NewReport from './pages/NewReport'
import MyReports from './pages/MyReports'
import Profile from './pages/Profile'
import ReportDetail from './pages/ReportDetail'
import AdminDashboard from './pages/AdminDashboard'
import AdminItems from './pages/AdminItems'
import AdminWorkers from './pages/AdminWorkers'
import AdminDeposits from './pages/AdminDeposits'

/** Početna strana zavisi od uloge: admin -> dashboard, radnik -> novi popis. */
function HomeRoute() {
  const { isAdmin } = useAuth()
  return isAdmin ? <AdminDashboard /> : <NewReport />
}

function MissingConfig() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="card max-w-lg p-6">
        <h1 className="text-lg font-bold text-rose-700">Nedostaje Supabase konfiguracija</h1>
        <p className="mt-2 text-sm text-slate-600">
          Napravi fajl <code className="rounded bg-slate-100 px-1">.env</code> u korenu projekta sa:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
{`VITE_SUPABASE_URL=https://tvoj-projekat.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
        </pre>
        <p className="mt-3 text-sm text-slate-600">
          Zatim restartuj <code className="rounded bg-slate-100 px-1">npm run dev</code>. Ako je
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
      <Route path="/prijava" element={<Login />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<HomeRoute />} />
        <Route path="novi-popis" element={<NewReport />} />
        <Route path="moji-izvestaji" element={<MyReports />} />
        <Route path="profil" element={<Profile />} />
        {/* Stara adresa — ako je neko sačuvao link ili ikonicu na telefonu. */}
        <Route path="moje-dnevnice" element={<Navigate to="/profil" replace />} />
        <Route path="izvestaj/:id" element={<ReportDetail />} />

        <Route
          path="artikli"
          element={
            <ProtectedRoute adminOnly>
              <AdminItems />
            </ProtectedRoute>
          }
        />
        <Route
          path="radnici"
          element={
            <ProtectedRoute adminOnly>
              <AdminWorkers />
            </ProtectedRoute>
          }
        />
        <Route
          path="uplate"
          element={
            <ProtectedRoute adminOnly>
              <AdminDeposits />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
