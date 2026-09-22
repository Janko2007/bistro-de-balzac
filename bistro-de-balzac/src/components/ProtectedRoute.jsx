import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { FullPageLoader, Button } from './ui'

export function ProtectedRoute({ children, adminOnly = false }) {
  const { session, profile, loading, isAdmin, signOut } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageLoader />

  if (!session) {
    return <Navigate to="/prijava" replace state={{ from: location.pathname }} />
  }

  // Sesija postoji, ali profil se još učitava
  if (!profile) return <FullPageLoader label="Učitavanje naloga…" />

  if (profile.is_active === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="text-5xl">🔒</div>
        <h1 className="text-xl font-bold text-slate-900">Nalog je deaktiviran</h1>
        <p className="max-w-sm text-sm text-slate-600">
          Tvoj nalog je privremeno isključen. Javi se vlasniku lokala.
        </p>
        <Button variant="secondary" onClick={signOut}>
          Odjavi se
        </Button>
      </div>
    )
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to="/" replace />
  }

  return children
}
